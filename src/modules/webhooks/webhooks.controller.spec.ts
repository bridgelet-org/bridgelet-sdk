import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { WebhookResponseDto } from './dto/webhook-response.dto.js';

const mockWebhooksService = {
  create: jest.fn(),
  findAll: jest.fn(),
};

function makeWebhookResponse(overrides = {}): WebhookResponseDto {
  return {
    id: 'wh-uuid-1',
    url: 'https://api.example.com/hooks',
    events: ['account.created'],
    isActive: true,
    description: null,
    lastTriggeredAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('WebhooksController', () => {
  let controller: WebhooksController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: mockWebhooksService },
      ],
    })
      .overrideGuard(require('../../common/guards/jwt-auth.guard.js').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('@nestjs/throttler').ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  describe('create', () => {
    it('delegates to webhooksService.create and returns the webhook', async () => {
      const dto: CreateWebhookDto = {
        url: 'https://api.example.com/hooks',
        events: ['account.created', 'sweep.completed'],
        secret: 'my-secret',
      };
      const response = makeWebhookResponse();
      mockWebhooksService.create.mockResolvedValue(response);

      const result = await controller.create(dto);

      expect(mockWebhooksService.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });

    it('passes through webhooks without optional fields', async () => {
      const dto: CreateWebhookDto = {
        url: 'https://api.example.com/hooks',
        events: ['account.expired'],
      };
      const response = makeWebhookResponse({ description: null });
      mockWebhooksService.create.mockResolvedValue(response);

      const result = await controller.create(dto);

      expect(result.description).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns a list of active webhooks', async () => {
      const webhooks = [makeWebhookResponse(), makeWebhookResponse({ id: 'wh-uuid-2' })];
      mockWebhooksService.findAll.mockResolvedValue(webhooks);

      const result = await controller.findAll();

      expect(mockWebhooksService.findAll).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('returns an empty array when no webhooks exist', async () => {
      mockWebhooksService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });
});
