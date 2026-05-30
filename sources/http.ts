import { SimpleSecureReq, type HTTPSRequestOptions } from '@typescriptprime/securereq'

type RequestMethodType = 'GET' | 'POST'

export type RequestOptionsType = {
	Method?: RequestMethodType
	Headers?: Record<string, string>
	Json?: unknown
	TLS?: HTTPSRequestOptions['TLS']
}

function BuildRequestOptions(URLInstance: URL, ExpectedAs: 'JSON' | 'ArrayBuffer', Options: RequestOptionsType = {}) {
	const Headers = {
		'user-agent': 'jsdelivr-purge-npm',
		...Options.Headers
	}

	return {
		ExpectedAs,
		HttpMethod: Options.Method ?? 'GET',
		HttpHeaders: Headers,
		Payload: typeof Options.Json === 'undefined' ? undefined : JSON.stringify(Options.Json),
		TLS: {
			IsHTTPSEnforced: URLInstance.protocol === 'https:',
			...Options.TLS
		}
	}
}

export async function RequestJSON<ResponseType>(URLInstance: URL, Options: RequestOptionsType = {}): Promise<ResponseType> {
	const Response = await SimpleSecureReq.Request(URLInstance, BuildRequestOptions(URLInstance, 'JSON', Options))
	return Response.Body as ResponseType
}

export async function RequestArrayBuffer(URLInstance: URL, Options: RequestOptionsType = {}): Promise<ArrayBuffer> {
	const Response = await SimpleSecureReq.Request(URLInstance, BuildRequestOptions(URLInstance, 'ArrayBuffer', Options))
	return Response.Body as ArrayBuffer
}
