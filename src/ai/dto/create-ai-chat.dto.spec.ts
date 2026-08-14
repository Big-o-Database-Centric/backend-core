import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAiChatDto } from './create-ai-chat.dto';

const instanceFor = (value: object) => plainToInstance(CreateAiChatDto, value);
const errorsFor = (value: object) => validateSync(instanceFor(value));

describe('CreateAiChatDto', () => {
  it('accepts the bounded default request', () => {
    expect(errorsFor({ messages: [{ role: 'user', content: 'Hola' }] })).toHaveLength(0);
  });

  it('trims padded content to exactly 4,000 characters before validation', () => {
    const instance = instanceFor({
      messages: [{ role: 'user', content: `  ${'x'.repeat(4000)}  ` }],
    });

    expect(validateSync(instance)).toHaveLength(0);
    expect(instance.messages[0].content).toBe('x'.repeat(4000));
  });

  it('rejects padded content whose trimmed length is 4,001 characters', () => {
    expect(errorsFor({
      messages: [{ role: 'user', content: `  ${'x'.repeat(4001)}  ` }],
    })).not.toHaveLength(0);
  });

  it.each([
    [{ messages: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' })) }],
    [{ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }],
    [{ messages: [{ role: 'tool', content: 'x' }] }],
    [{ messages: [{ role: 'user', content: 'x' }], maxTokens: 0 }],
    [{ messages: [{ role: 'user', content: 'x' }], maxTokens: 513 }],
    [{ messages: [{ role: 'user', content: 1 }] }],
  ])('rejects an out-of-contract request', (value) => {
    expect(errorsFor(value)).not.toHaveLength(0);
  });
});
