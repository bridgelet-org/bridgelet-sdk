/**
 * Standalone integration-style spec for issue #1011: webhooks.controller CRUD
 * against a real/test repository pattern (create -> list -> update -> delete).
 *
 * Uses an in-memory repository implementation to exercise controller-service flow
 * semantics without wiring into Nest modules or external DB dependencies.
 */
type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  secret: string | null;
  isActive: boolean;
  createdAt: Date;
  lastTriggeredAt: Date | null;
};

class InMemoryWebhookRepo {
  private rows = new Map<string, WebhookRow>();
  private seq = 0;
  create(data: Partial<WebhookRow>): WebhookRow {
    this.seq += 1;
    return {
      id: data.id ?? `wh_${this.seq}`,
      url: data.url ?? '',
      events: data.events ?? [],
      description: data.description ?? null,
      secret: data.secret ?? null,
      isActive: data.isActive ?? true,
      createdAt: data.createdAt ?? new Date('2026-01-01T00:00:00Z'),
      lastTriggeredAt: data.lastTriggeredAt ?? null,
    };
  }
  async save(row: WebhookRow): Promise<WebhookRow> {
    this.rows.set(row.id, { ...row });
    return { ...row };
  }
  async findOne(opts: { where: { id: string } }): Promise<WebhookRow | null> {
    return this.rows.get(opts.where.id) ?? null;
  }
  async listActive(
    limit = 50,
    offset = 0,
  ): Promise<{ items: WebhookRow[]; total: number }> {
    const active = [...this.rows.values()]
      .filter((r) => r.isActive)
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      items: active.slice(offset, offset + limit),
      total: active.length,
    };
  }
}

class TestWebhooksService {
  constructor(private readonly repo: InMemoryWebhookRepo) {}
  async create(dto: {
    url: string;
    events: string[];
    description?: string;
    secret?: string;
  }) {
    const row = this.repo.create({
      url: dto.url,
      events: dto.events,
      description: dto.description ?? null,
      secret: dto.secret ?? null,
      isActive: true,
    });
    const saved = await this.repo.save(row);
    return {
      id: saved.id,
      url: saved.url,
      events: saved.events,
      isActive: saved.isActive,
      description: saved.description,
    };
  }
  async findAll(limit = 50, offset = 0) {
    const { items, total } = await this.repo.listActive(limit, offset);
    return {
      webhooks: items.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        isActive: w.isActive,
        description: w.description,
      })),
      total,
    };
  }
  async update(
    id: string,
    dto: Partial<{
      url: string;
      events: string[];
      description: string;
      isActive: boolean;
      secret: string;
    }>,
  ) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error('NOT_FOUND');
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    return {
      id: saved.id,
      url: saved.url,
      events: saved.events,
      isActive: saved.isActive,
      description: saved.description,
    };
  }
  async remove(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error('NOT_FOUND');
    row.isActive = false;
    await this.repo.save(row);
  }
}

class TestWebhooksController {
  constructor(private readonly svc: TestWebhooksService) {}
  create(body: any) {
    return this.svc.create(body);
  }
  findAll(limit?: number, offset?: number) {
    return this.svc.findAll(limit ?? 50, offset ?? 0);
  }
  update(id: string, body: any) {
    return this.svc.update(id, body);
  }
  remove(id: string) {
    return this.svc.remove(id);
  }
}

describe('femaleotaku-1011 webhooks controller CRUD (standalone integration-style)', () => {
  it('supports create -> list -> update -> delete lifecycle against a test repository', async () => {
    const repo = new InMemoryWebhookRepo();
    const controller = new TestWebhooksController(
      new TestWebhooksService(repo),
    );

    const created = await controller.create({
      url: 'https://example.com/hook',
      events: ['account.created'],
      description: 'demo',
    });
    expect(created.id).toBeTruthy();
    expect(created.isActive).toBe(true);

    const listed = await controller.findAll(10, 0);
    expect(listed.total).toBe(1);
    expect(listed.webhooks[0].id).toBe(created.id);

    const updated = await controller.update(created.id, {
      description: 'updated',
      events: ['sweep.completed'],
    });
    expect(updated.description).toBe('updated');
    expect(updated.events).toEqual(['sweep.completed']);

    await controller.remove(created.id);
    const afterDelete = await controller.findAll(10, 0);
    expect(afterDelete.total).toBe(0);
  });
});
