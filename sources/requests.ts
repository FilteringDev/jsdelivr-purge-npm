import got from 'got'
import * as Actions from '@actions/core'
import * as Os from 'node:os'
import PLimit from 'p-limit'
import * as ESToolkit from 'es-toolkit'

type CDNStatusResponseType = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	id: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	status: 'pending' | 'finished' | 'failed';
	// eslint-disable-next-line @typescript-eslint/naming-convention
	paths: Record<string, {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		throttled: boolean;
		// eslint-disable-next-line @typescript-eslint/naming-convention
		providers: {
			CF: boolean;
			FY: boolean;
		};
	}>;
}

type CDNPostResponseType = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	id: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	status: 'pending' | 'finished' | 'failed';
	// eslint-disable-next-line @typescript-eslint/naming-convention
	timestamp: string;
}

type CDNPostRequestType = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	path: string[];
}

type RemainingFilenamesArrayType = {
	Filename: string;
	Tag: string;
}

async function GetCDNResponse(ID: string): Promise<CDNStatusResponseType> {
	const ResponseRaw: CDNStatusResponseType = await got(`https://purge.jsdelivr.net/status/${ID}`, {
		https: {
			minVersion: 'TLSv1.3',
			ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256'
		},
		http2: true,
		headers: {
			'user-agent': 'jsdelivr-purge-npm'
		}
	}).json()

	for (const [Key, Value] of Object.entries(ResponseRaw.paths)) {
		if (Value.throttled) {
			Actions.warning(`Throttled: ${Key}`)
		}
	}

	Actions.startGroup(`GetCDNResponse called: ${ID}`)
	Actions.info(JSON.stringify(ResponseRaw))
	Actions.endGroup()
	return ResponseRaw
}

async function PostPurgeRequest(Repo: string, Tag: string[], Filenames: string[]): Promise<CDNPostResponseType> {
	const ResponseRaw: CDNPostResponseType = await got.post('https://purge.jsdelivr.net/', {
		headers: {
			'cache-control': 'no-cache',
			'user-agent': 'jsdelivr-purge'
		},
		json: {
			path: new Array(Filenames.length).fill(null, 0, Filenames.length).map((Filename, Index) => `/npm/${Repo}@${Tag[Index]}/${Filenames[Index]}`)
		} satisfies CDNPostRequestType,
		https: {
			minVersion: 'TLSv1.3',
			ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256'
		},
		http2: true
	}).json()
	Actions.startGroup(`PostPurgeRequest called: ${ResponseRaw.id}`)
	Actions.info(JSON.stringify(ResponseRaw))
	Actions.endGroup()
	return ResponseRaw
}

export class PurgeRequestManager {
	private readonly SharedPLimit = PLimit(Os.cpus().length)
	private readonly RemainingFilenames: RemainingFilenamesArrayType[] = []

	constructor(private readonly Repo: string) {}

	AddURLs(Filenames: string[], Tag: string) {
		const SplittedFilenames = ESToolkit.chunk(Filenames.map(Filename => ({Filename, Tag})), 20)

		if (SplittedFilenames[SplittedFilenames.length - 1].length < 20) {
			this.RemainingFilenames.push(...SplittedFilenames.pop())
		}

		for (const SplittedFilenameGroup of SplittedFilenames) {
			void this.SharedPLimit(async () => {
				const CDNRequestArary: CDNPostResponseType[] = []
				while (CDNRequestArary.length === 0 || !CDNRequestArary.some(async CDNResponse => (await GetCDNResponse(CDNResponse.id)).status === 'finished'
					|| (await GetCDNResponse(CDNResponse.id)).status === 'failed')) {
					const CDNRequest: CDNPostResponseType = await PostPurgeRequest(this.Repo, new Array(20).fill(Tag, 0, 20) as string[], SplittedFilenameGroup.map(SplittedFilename => SplittedFilename.Filename))
					CDNRequestArary.push(CDNRequest)
					await new Promise(Resolve => {
						setTimeout(Resolve, 2500)
					})
				}

				Actions.info(`Queue: jsDelivr server returns that the following files are purged:
				${SplittedFilenameGroup.map(Filename => `@${Filename.Tag}/${Filename.Filename}`).map(Item => `- ${Item}`).join('\n')}
				`)
			})
		}
	}

	Start(): void {
		const RemainingFilenamesGroup = ESToolkit.chunk(this.RemainingFilenames, 20)
		for (const RemainingFilenames of RemainingFilenamesGroup) {
			void this.SharedPLimit(async () => {
				const CDNRequestArary: CDNPostResponseType[] = []
				while (CDNRequestArary.length === 0 || !CDNRequestArary.some(async CDNResponse => (await GetCDNResponse(CDNResponse.id)).status === 'finished'
					|| (await GetCDNResponse(CDNResponse.id)).status === 'failed')) {
					const CDNRequest: CDNPostResponseType = await PostPurgeRequest(this.Repo, RemainingFilenames.map(RemainingFilename => RemainingFilename.Tag), RemainingFilenames.map(RemainingFilename => RemainingFilename.Filename))
					CDNRequestArary.push(CDNRequest)
					await new Promise(Resolve => {
						setTimeout(Resolve, 2500)
					})
				}

				Actions.info('Queue: jsDelivr server returns that the following files are purged:')
				Actions.info(`${RemainingFilenames.map(Filename => `@${Filename.Tag}/${Filename.Filename}`).map(Item => `- ${Item}`).join('\n')}`)
			})
		}
	}
}
