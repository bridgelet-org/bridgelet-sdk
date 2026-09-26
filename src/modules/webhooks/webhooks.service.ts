import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Webhook } from './entities/webhook.entity.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';
import { WebhookResponseDto } from './dto/webhook-response.dto.js';
import { parsePagination } from '../../common/utils/pagination.util.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
  ) {}

  async create(dto: CreateWebhookDto): Promise<WebhookResponseDto> {
    const webhook = this.webhookRepository.create({
      url: dto.url,
      events: dto.events,
      secret: dto.secret ?? null,
      description: dto.description ?? null,
      isActive: true,
    });
    const saved = await this.webhookRepository.save(webhook);
    return this.toResponseDto(saved);
  }

  /**
   * Returns active subscriptions, paginated.
   *
   * `limit`/`offset` are normalised by `parsePagination`, which rejects
   * non-integer input with a 400 and clamps out-of-range values. Without it a
   * `?limit=abc` reached TypeORM as `NaN` and surfaced as a 500 from the
   * query builder.
   *
   * The explicit `ORDER BY createdAt, id` matters: without a deterministic
   * order PostgreSQL may return matching rows in any order, so a row could
   * appear on two consecutive pages or on neither as the table changes.
   */
  async findAll(
    limit?: number | string,
    offset?: number | string,
  ): Promise<{ webhooks: WebhookResponseDto[]; total: number }> {
    const page = parsePagination(limit, offset);

    const query = this.webhookRepository
      .createQueryBuilder('webhook')
      .where('webhook.isActive = :isActive', { isActive: true })
      .orderBy('webhook.createdAt', 'ASC')
      .addOrderBy('webhook.id', 'ASC')
      .skip(page.offset)
      .take(page.limit);

    const [webhooks, total] = await query.getManyAndCount();
    return { webhooks: webhooks.map((w) => this.toResponseDto(w)), total };
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    const webhook = await this.webhookRepository.findOne({
      where: { id },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    if (dto.url !== undefined) {
      webhook.url = dto.url;
    }

    if (dto.events !== undefined) {
      webhook.events = dto.events;
    }

    if (dto.description !== undefined) {
      webhook.description = dto.description;
    }

    if (dto.isActive !== undefined) {
      webhook.isActive = dto.isActive;
    }

    if (dto.secret !== undefined) {
      webhook.secret = dto.secret;
    }

    const updatedWebhook = await this.webhookRepository.save(webhook);

    return this.toResponseDto(updatedWebhook);
  }

  async remove(id: string): Promise<void> {
    const webhook = await this.webhookRepository.findOne({
      where: { id },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    webhook.isActive = false;

    await this.webhookRepository.save(webhook);
  }

  /**
   * Fires an event to all active webhooks subscribed to that event type.
   * Never throws — delivery failures are logged but do not propagate.
   */
  async triggerEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let webhooks: Webhook[];
    try {
      webhooks = await this.webhookRepository
        .createQueryBuilder('webhook')
        .where('webhook.isActive = :isActive', { isActive: true })
        .andWhere('webhook.events @> :events::jsonb', {
          events: JSON.stringify([eventType]),
        })
        .getMany();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to query webhooks for event ${eventType}: ${msg}`,
      );
      return;
    }

    if (webhooks.length === 0) return;

    await Promise.allSettled(
      webhooks.map((webhook) => this.deliver(webhook, eventType, payload)),
    );
  }

  private async deliver(
    webhook: Webhook,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({ event: eventType, ...payload });
    const signature = this.computeSignature(body, webhook.secret);

    const rawAccountId = payload['accountId'];
    const accountId =
      typeof rawAccountId === 'string' ? rawAccountId : 'unknown';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridgelet-Signature': `sha256=${signature}`,
          'X-Bridgelet-Event': eventType,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `Webhook delivery failed: event=${eventType}, accountId=${accountId}, ` +
            `url=${webhook.url}, status=${response.status}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Webhook delivery error: event=${eventType}, accountId=${accountId}, ` +
          `url=${webhook.url}, error=${msg}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    try {
      await this.webhookRepository.update(webhook.id, {
        lastTriggeredAt: new Date(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to update lastTriggeredAt for webhook ${webhook.id}: ${msg}`,
      );
    }
  }

  private computeSignature(payload: string, secret: string | null): string {
    return crypto
      .createHmac('sha256', secret ?? '')
      .update(payload)
      .digest('hex');
  }

  private toResponseDto(webhook: Webhook): WebhookResponseDto {
    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      isActive: webhook.isActive,
      description: webhook.description,
      lastTriggeredAt: webhook.lastTriggeredAt,
      createdAt: webhook.createdAt,
    };
  }
}
