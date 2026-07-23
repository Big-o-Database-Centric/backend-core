import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the root module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('MSSQL_POOL')
      .useValue({ request: () => ({ input: () => {}, execute: async () => ({ recordset: [] }) }) })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) => `test-${key}`,
        getOrThrow: (key: string) => `test-${key}`,
      })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
