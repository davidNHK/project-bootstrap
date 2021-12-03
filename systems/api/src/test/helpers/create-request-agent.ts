import { expect } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { SuperAgentTest } from 'supertest';
import * as request from 'supertest';

export function createRequestAgent(app: INestApplication) {
  const { testPath = 'N/A', currentTestName = 'N/A' } = expect.getState();
  return request.agent(app).set({
    'X-Test-Name': encodeURI(currentTestName),
    'X-Test-Path': encodeURI(testPath),
  }) as unknown as SuperAgentTest;
}