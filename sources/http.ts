import { SimpleSecureReq } from '@typescriptprime/securereq'
import type {
  ExpectedAsKey,
  ExpectedAsMap,
  HTTPSRequestOptions,
  HTTPSResponse
} from '@typescriptprime/securereq'
import * as Zod from 'zod'

function CreateDefaultHeaders(HttpHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': 'jsdelivr-purge-npm',
    ...HttpHeaders
  }
}

function CreateRequestOptions<E extends ExpectedAsKey>(
  URLInstance: URL,
  Options: HTTPSRequestOptions<E> & { ExpectedAs: E }
): HTTPSRequestOptions<E> & { ExpectedAs: E } {
  return {
    ...Options,
    HttpHeaders: CreateDefaultHeaders(Options.HttpHeaders),
    TLS: {
      IsHTTPSEnforced: URLInstance.protocol === 'https:',
      ...Options.TLS
    }
  }
}

function EnsureSuccessStatusCode<T>(Response: HTTPSResponse<T>, URLInstance: URL): void {
  if (Response.StatusCode < 200 || Response.StatusCode >= 300) {
    throw new Error('Request failed for ' + URLInstance.toString() + ' with status ' + Response.StatusCode)
  }
}

export async function RequestExpectedAs<E extends ExpectedAsKey>(
  URLInstance: URL,
  Options: HTTPSRequestOptions<E> & { ExpectedAs: E }
): Promise<HTTPSResponse<ExpectedAsMap[E]>> {
  return SimpleSecureReq.Request(URLInstance, CreateRequestOptions(URLInstance, Options))
}

export async function RequestJSON<T extends Zod.ZodType>(
  URLInstance: URL,
  Schema: T,
  Options: Omit<HTTPSRequestOptions<'JSON'>, 'ExpectedAs'> = {}
): Promise<Zod.infer<T>> {
  const Response = await RequestExpectedAs(URLInstance, {
    ...Options,
    ExpectedAs: 'JSON'
  })

  EnsureSuccessStatusCode(Response, URLInstance)
  return Schema.parseAsync(Response.Body)
}

export async function RequestBuffer(
  URLInstance: URL,
  Options: Omit<HTTPSRequestOptions<'ArrayBuffer'>, 'ExpectedAs'> = {}
): Promise<Buffer> {
  const Response = await RequestExpectedAs(URLInstance, {
    ...Options,
    ExpectedAs: 'ArrayBuffer'
  })

  EnsureSuccessStatusCode(Response, URLInstance)
  return Buffer.from(Response.Body)
}
