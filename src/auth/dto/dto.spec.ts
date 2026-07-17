import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';

describe('RegisterDto', () => {
  it('rejects a payload missing email', async () => {
    const dto = plainToInstance(RegisterDto, { name: 'Ada', password: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('accepts a well-formed payload', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'x',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('LoginDto', () => {
  it('rejects a non-email value', async () => {
    const dto = plainToInstance(LoginDto, { email: 'not-an-email', password: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
