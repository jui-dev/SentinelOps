import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { CommonModule } from './../src/common/common.module.js';

/**
 * Validation needs routes that accept payloads, and no domain module exists
 * yet. The controllers below are declared here rather than in `src/`, so no
 * test-only code ships — while the pipe, the exception factory, and the filter
 * under test are the real ones, taken from CommonModule.
 */
const createIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  responders: z
    .array(z.object({ email: z.email(), pageCount: z.coerce.number().int().min(1) }))
    .optional(),
});

const strictSchema = z.object({ title: z.string() }).strict();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('incidents')
class TestIncidentsController {
  @Post()
  create(@Body({ schema: createIncidentSchema }) body: unknown): unknown {
    return body;
  }

  @Post('strict')
  createStrict(@Body({ schema: strictSchema }) body: unknown): unknown {
    return body;
  }

  @Get()
  list(@Query({ schema: listQuerySchema }) query: unknown): unknown {
    return query;
  }

  /** No schema declared — proves the global pipe leaves such params alone. */
  @Get('unvalidated/:id')
  find(@Param('id') id: string): { id: string; type: string } {
    return { id, type: typeof id };
  }

  @Get('boom')
  boom(): never {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
  }
}

describe('Request validation (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommonModule],
      controllers: [TestIncidentsController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('accepting valid input', () => {
    it('should accept a valid body', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({ title: 'Checkout latency spike', severity: 'high' })
        .expect(201);

      expect(response.body).toEqual({
        title: 'Checkout latency spike',
        severity: 'high',
      });
    });

    it('should return the coerced value, not the raw input', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({
          title: 'Coercion',
          severity: 'low',
          responders: [{ email: 'on-call@example.com', pageCount: '3' }],
        })
        .expect(201);

      expect(response.body.responders[0].pageCount).toBe(3);
    });

    it('should strip unknown keys by default', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({ title: 'Stripping', severity: 'low', isAdmin: true })
        .expect(201);

      expect(response.body).not.toHaveProperty('isAdmin');
    });

    it('should coerce and default query parameters', async () => {
      await request(app.getHttpServer())
        .get('/incidents?limit=10')
        .expect(200)
        .expect({ limit: 10 });

      await request(app.getHttpServer()).get('/incidents').expect(200).expect({
        limit: 25,
      });
    });

    it('should leave parameters without a schema untouched', async () => {
      await request(app.getHttpServer())
        .get('/incidents/unvalidated/123')
        .expect(200)
        .expect({ id: '123', type: 'string' });
    });
  });

  describe('rejecting invalid input', () => {
    it('should return the validation contract for a missing field', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({ severity: 'high' })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request validation failed',
        path: '/incidents',
      });
      expect(typeof response.body.message).toBe('string');
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.body.details).toEqual([
        { field: 'title', message: expect.any(String) },
      ]);
    });

    it('should report every invalid field, not just the first', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({ title: '', severity: 'catastrophic' })
        .expect(400);

      expect(response.body.details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['title', 'severity']),
      );
      expect(response.body.details.length).toBe(2);
    });

    it('should report nested and array failures with a dotted field path', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({
          title: 'Nested',
          severity: 'low',
          responders: [{ email: 'not-an-email', pageCount: 1 }],
        })
        .expect(400);

      expect(response.body.details).toEqual([
        { field: 'responders.0.email', message: expect.any(String) },
      ]);
    });

    it('should reject unknown keys against a strict schema', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents/strict')
        .send({ title: 'Strict', isAdmin: true })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.details.length).toBeGreaterThan(0);
    });

    it('should not echo the submitted value back', async () => {
      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send({ title: '', severity: 'nope', secret: 'hunter2' })
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain('hunter2');
    });
  });

  describe('unexpected handler errors', () => {
    it('should mask a thrown Error as a generic 500', async () => {
      const response = await request(app.getHttpServer())
        .get('/incidents/boom')
        .expect(500);

      expect(response.body).toMatchObject({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
      });
      expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
    });
  });
});
