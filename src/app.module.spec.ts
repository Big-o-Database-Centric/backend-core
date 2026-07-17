import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the root module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('MSSQL_POOL')
      .useValue({ request: () => ({ input: () => {}, execute: async () => ({ recordset: [] }) }) })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
