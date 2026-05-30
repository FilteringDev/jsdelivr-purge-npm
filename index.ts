import * as Actions from '@actions/core'
import * as Os from 'node:os'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as ESToolkit from 'es-toolkit'
import { FilterArgumentsForOptions, ParseArgumentsAndOptions } from '@typescriptprime/parsing'
import { Piscina } from 'piscina'
import { fileURLToPath } from 'node:url'
import { RequestNpmPackageMetaData } from './sources/npm-api.js'
import { HistoryManager, type IHistoryManagerDataJSON } from './sources/github.js'

export type TagWorkerDataType = {
	Package: string
	TargetTag: string
	CurrentTags: Record<string, string>
	OlderTags: IHistoryManagerDataJSON | null
}

type OptionsType = {
	GitHubToken: string
	Package: string
	CIWorkspacePath: string
	CIActionPath: string
	WorkflowRef: string
	DistTag: string
	Repo: string
}

const CurrentFilename = fileURLToPath(import.meta.url)
const CurrentDirname = Path.dirname(CurrentFilename)
const TagWorkerFilename = Path.join(CurrentDirname, 'sources', 'tag-worker.ts')

Actions.info(`Running on ${Os.cpus()[0].model} with ${Os.cpus().length} threads/vCPUs.`)

const Options = await ParseOptions(process.argv)

const CurrrentTags = (await RequestNpmPackageMetaData(Options.Package))['dist-tags']
const DistTagFilePath = CreateDistTagFilePath()
Fs.writeFileSync(DistTagFilePath, JSON.stringify(CurrrentTags), { mode: 0o600 })
const OlderTags = await new HistoryManager({ Repo: Options.Repo, GitHubToken: Options.GitHubToken, WorkflowRef: Options.WorkflowRef }).RequestHistory()
const PiscinaInstance = new Piscina({
	filename: TagWorkerFilename,
	maxThreads: Os.cpus().length,
	execArgv: [...process.execArgv]
})

try {
	await Promise.all(Options.DistTag.split(' ').filter(TargetTag => TargetTag.length > 0).map(TargetTag => PiscinaInstance.run({
		Package: Options.Package,
		TargetTag,
		CurrentTags: CurrrentTags,
		OlderTags
	} satisfies TagWorkerDataType)))
} finally {
	await PiscinaInstance.destroy()
}

function CreateDistTagFilePath(): string {
	const DistTagDirectory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jsdelivr-purge-npm-'))
	const DistTagFilePath = Path.join(DistTagDirectory, 'dist-tag.json')

	Actions.exportVariable('DIST_TAG_FILE', DistTagFilePath)

	return DistTagFilePath
}

async function ParseOptions(Argv: string[]): Promise<OptionsType> {
	const { Options } = await ParseArgumentsAndOptions<Record<string, string | boolean>>(FilterArgumentsForOptions(Argv))

	return {
		GitHubToken: GetOptionValue(Options, 'GhToken'),
		Package: GetOptionValue(Options, 'Package'),
		CIWorkspacePath: GetOptionValue(Options, 'CiWorkspacePath'),
		CIActionPath: GetOptionValue(Options, 'CiActionPath'),
		WorkflowRef: GetOptionValue(Options, 'WorkflowRef'),
		DistTag: GetOptionValue(Options, 'DistTag'),
		Repo: GetOptionValue(Options, 'Repo')
	}
}

function GetOptionValue(Options: Record<string, string | boolean>, OptionName: string): string {
	const Value = Options[OptionName]

	return typeof Value === 'string' ? Value : ''
}
