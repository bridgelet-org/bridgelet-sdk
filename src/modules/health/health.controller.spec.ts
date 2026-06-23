import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns status ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('returns a timestamp', () => {
    const result = controller.check();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('reports all services as ok', () => {
    const result = controller.check();
    expect(result.services.database).toBe('ok');
    expect(result.services.stellar).toBe('ok');
    expect(result.services.soroban).toBe('ok');
  });
});
