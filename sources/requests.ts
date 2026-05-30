import * as Actions from '@actions/core'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Piscina } from 'piscina'
import * as ESToolkit from 'es-toolkit'
import { fileURLToPath } from 'node:url'
import { RequestJSON } from './http.js'

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

export type PurgeWorkerDataType = {
	Repo: string
	Filenames: RemainingFilenamesArrayType[]
}

const CurrentFilename = fileURLToPath(import.meta.url)
const CurrentDirname = Path.dirname(CurrentFilename)
const PurgeWorkerFilename = Path.join(CurrentDirname, 'purge-worker.ts')
const PollIntervalMS = Number.parseInt(process.env.JSDELIVR_PURGE_NPM_POLL_INTERVAL_MS ?? '2500', 10)

function GetPurgeBaseURL(): URL {
	return new URL(process.env.JSDELIVR_PURGE_NPM_PURGE_URL ?? 'https://purge.jsdelivr.net/')
}

async function GetCDNResponse(ID: string): Promise<CDNStatusResponseType> {
	const StatusURL = new URL(`status/${encodeURIComponent(ID)}`, GetPurgeBaseURL())
	const ResponseRaw = await RequestJSON<CDNStatusResponseType>(StatusURL)

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

async function PostPurgeRequest(Repo: string, Filenames: RemainingFilenamesArrayType[]): Promise<CDNPostResponseType> {
	const ResponseRaw = await RequestJSON<CDNPostResponseType>(GetPurgeBaseURL(), {
		Method: 'POST',
		Headers: {
			'cache-control': 'no-cache',
			'content-type': 'application/json'
		},
		Json: {
			path: Filenames.map(Filename => `/npm/${Repo}@${Filename.Tag}/${Filename.Filename}`)
		} satisfies CDNPostRequestType
	})
	Actions.startGroup(`PostPurgeRequest called: ${ResponseRaw.id}`)
	Actions.info(JSON.stringify(ResponseRaw))
	Actions.endGroup()
	return ResponseRaw
}

export class PurgeRequestManager {
	private readonly Batches: RemainingFilenamesArrayType[][] = []
	private readonly RemainingFilenames: RemainingFilenamesArrayType[] = []

	constructor(private readonly Repo: string) {}

	AddURLs(Filenames: string[], Tag: string) {
		const SplittedFilenames = ESToolkit.chunk(Filenames.map(Filename => ({Filename, Tag})), 20)
		const LastGroup = SplittedFilenames.at(-1)

		if (typeof LastGroup !== 'undefined' && LastGroup.length < 20) {
			const RemainingFilenameGroup = SplittedFilenames.pop()
			if (typeof RemainingFilenameGroup !== 'undefined') {
				this.RemainingFilenames.push(...RemainingFilenameGroup)
			}
		}

		this.Batches.push(...SplittedFilenames)
	}

	async Start(): Promise<void> {
		this.Batches.push(...ESToolkit.chunk(this.RemainingFilenames, 20))
		const PiscinaInstance = new Piscina({
			filename: PurgeWorkerFilename,
			maxThreads: Os.cpus().length
		})

		try {
			await Promise.all(this.Batches.filter(Batch => Batch.length > 0).map(Batch => PiscinaInstance.run({
				Repo: this.Repo,
				Filenames: Batch
			} satisfies PurgeWorkerDataType)))
		} finally {
			await PiscinaInstance.destroy()
		}
	}
}

export async function ProcessPurgeBatch(TaskData: PurgeWorkerDataType): Promise<void> {
	const CDNRequest = await PostPurgeRequest(TaskData.Repo, TaskData.Filenames)
	let CDNResponse = await GetCDNResponse(CDNRequest.id)

	while (CDNResponse.status === 'pending') {
		await new Promise(Resolve => {
			setTimeout(Resolve, PollIntervalMS)
		})
		CDNResponse = await GetCDNResponse(CDNRequest.id)
	}

	Actions.info('Queue: jsDelivr server returns that the following files are purged:')
	Actions.info(`${TaskData.Filenames.map(Filename => `@${Filename.Tag}/${Filename.Filename}`).map(Item => `- ${Item}`).join('\n')}`)
}
