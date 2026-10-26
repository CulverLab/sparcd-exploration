// Checking a typed endpoint, ported from the old explorer's `parse_endpoint`.
// Accepts a bare name with an optional :port, or an http(s) address. Each
// problem says what is in the text in plain words: the people signing in are
// not expected to know URL syntax.

export type ParsedEndpoint = { endpoint: string; secure: boolean; problem: string | null };

export function parseEndpoint(raw: string, defaultSecure: boolean): ParsedEndpoint {
  const text = raw.trim();
  let scheme = /^([a-z][a-z0-9+.-]*):(\/*)/i.exec(text);
  // "localhost:9000" matches too; with no slashes it is a name and a number.
  if (scheme && !scheme[2] && !/^https?$/i.test(scheme[1])) scheme = null;
  const secure = scheme ? scheme[1].toLowerCase() === 'https' : defaultSecure;
  const fail = (problem: string): ParsedEndpoint => ({ endpoint: text, secure, problem });

  if (/\s/.test(text)) return fail('Remove the spaces.');
  if (scheme && !/^https?$/i.test(scheme[1])) return fail(`Start it with https:// instead of ${scheme[0]}`);
  if (scheme && scheme[2] !== '//') return fail(`Use exactly two slashes after “${scheme[1]}:”.`);

  const afterScheme = scheme ? text.slice(scheme[0].length) : text;
  const authority = /^[^/?#]*/.exec(afterScheme)![0];
  const rest = afterScheme.slice(authority.length);
  if (authority.includes('@')) return fail('Remove the “@” and everything before it.');
  const hostPort = /^(\[[^\]]*\]|[^:[\]]*)(?::(.*))?$/.exec(authority);
  if (!hostPort) return fail("This doesn't look like a web address.");
  const [, host, port] = hostPort;
  if (port !== undefined && !(/^\d+$/.test(port) && Number(port) <= 65535)) {
    return fail('The number after the “:” isn\'t valid.');
  }
  if (!host || host === '[]') return fail('The server name is missing.');
  if (rest !== '' && rest !== '/') return fail(`Remove “${rest}” from the end.`);
  return { endpoint: authority, secure, problem: null };
}
