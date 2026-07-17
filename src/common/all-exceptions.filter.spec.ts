import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('maps an unhandled non-HttpException error to 500 { error: "Database error" }', () => {
    const filter = new AllExceptionsFilter();
    const { host, response } = mockHost();

    filter.catch(new Error('connection reset by mssql pool'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'Database error' });
  });

  it('preserves the status code and body of an HttpException (e.g. UnauthorizedException)', () => {
    const filter = new AllExceptionsFilter();
    const { host, response } = mockHost();
    const exception = new UnauthorizedException('Invalid credentials');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });
});
