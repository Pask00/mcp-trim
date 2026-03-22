import { describe, it, expect } from 'vitest';
import { extractJson, replaceJsonInText } from '../src/core/json-extractor.js';

describe('extractJson', () => {
  it('extracts a single JSON object', () => {
    const text = '{"id": 1, "name": "test"}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual({ id: 1, name: 'test' });
    expect(matches[0].startIndex).toBe(0);
    expect(matches[0].endIndex).toBe(text.length);
  });

  it('extracts a JSON array', () => {
    const text = '[1, 2, 3]';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual([1, 2, 3]);
  });

  it('extracts JSON from text with leading content', () => {
    const text = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id": 42}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual({ id: 42 });
  });

  it('extracts multiple JSON blocks', () => {
    const text = '{"a": 1} some text {"b": 2}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].value).toEqual({ a: 1 });
    expect(matches[1].value).toEqual({ b: 2 });
  });

  it('returns empty for non-JSON text', () => {
    const text = 'Hello, world! No JSON here.';
    const matches = extractJson(text);
    expect(matches).toHaveLength(0);
  });

  it('handles nested JSON correctly', () => {
    const text = '{"outer": {"inner": true}}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual({ outer: { inner: true } });
  });

  it('handles strings containing braces', () => {
    const text = '{"msg": "hello {world}"}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual({ msg: 'hello {world}' });
  });

  it('handles escaped quotes in strings', () => {
    const text = '{"msg": "say \\"hello\\""}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect((matches[0].value as any).msg).toBe('say "hello"');
  });

  it('returns empty for invalid JSON-looking text', () => {
    const text = '{invalid json}';
    const matches = extractJson(text);
    expect(matches).toHaveLength(0);
  });

  it('handles whitespace around JSON', () => {
    const text = '   \n  {"id": 1}  \n   ';
    const matches = extractJson(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual({ id: 1 });
  });
});

describe('replaceJsonInText', () => {
  it('replaces JSON in mixed text', () => {
    const text = 'Result: {"id": 1, "name": "test", "extra": "gone"}\nDone.';
    const result = replaceJsonInText(text, (json: unknown) => {
      const obj = json as Record<string, unknown>;
      return { id: obj.id };
    });
    expect(result).toContain('"id":1');
    expect(result).not.toContain('"name"');
    expect(result).toContain('Result: ');
    expect(result).toContain('\nDone.');
  });

  it('returns original text when no JSON found', () => {
    const text = 'Just plain text.';
    const result = replaceJsonInText(text, (json) => json);
    expect(result).toBe(text);
  });

  it('replaces multiple JSON blocks', () => {
    const text = '{"a": 1, "b": 2} middle {"c": 3, "d": 4}';
    const result = replaceJsonInText(text, (json: unknown) => {
      const obj = json as Record<string, unknown>;
      const firstKey = Object.keys(obj)[0];
      return { [firstKey]: obj[firstKey] };
    });
    expect(result).toContain('"a"');
    expect(result).not.toContain('"b"');
    expect(result).toContain(' middle ');
    expect(result).toContain('"c"');
    expect(result).not.toContain('"d"');
  });
});
