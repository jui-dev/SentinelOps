import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let healthController: HealthController;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    healthController = app.get<HealthController>(HealthController);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('liveness', () => {
    it('should return the ok status', () => {
      expect(healthController.getHealth()).toEqual({ status: 'ok' });
    });

    it('should not query the database', () => {
      healthController.getHealth();

      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('should report the database as up when the probe succeeds', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(healthController.getReadiness()).resolves.toEqual({
        status: 'ok',
        database: 'up',
      });
    });

    it('should fail with 503 when the probe fails', async () => {
      queryRaw.mockRejectedValue(new Error('connection refused'));

      await expect(healthController.getReadiness()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
