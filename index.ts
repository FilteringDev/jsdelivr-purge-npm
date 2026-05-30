import * as Commander from 'commander'
import * as Actions from '@actions/core'
import * as Os from 'node:os'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
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

const CurrentFilename = fileURLToPath(import.meta.url)
const CurrentDirname = Path.dirname(CurrentFilename)
const TagWorkerFilename = Path.join(CurrentDirname, 'sources', 'tag-worker.ts')

Actions.info(`Running on ${Os.cpus()[0].model} with ${Os.cpus().length} threads/vCPUs.`)

const Program = new Commander.Command()

// Set options.
Program.option('--gh-token <TOKEN>', 'GitHub token', '')
	.option('--package <package>', 'A npm package. eg: owner/repo', '')
	.option('--ci-workspace-path <PATH>', 'A path to the CI workspace.', '')
	.option('--ci-action-path <PATH>', 'A path to the CI action.', '')
	.option('--workflow-ref <WORKFLOW_REF>', 'A GitHub workflow ref. eg: refs/heads/master', '')
	.option('--dist-tag <DIST_TAG>', 'A npm dist-tag. eg: latest', '')
	.option('--repo <REPO>', 'A GitHub repository. eg: owner/repo', '')

// Initialize Input of the options and export them.
Program.parse()

const Options = Program.opts() as {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	ghToken: string
	// eslint-disable-next-line @typescript-eslint/naming-convention
	package: string
	// eslint-disable-next-line @typescript-eslint/naming-convention
	ciWorkspacePath: string
	// eslint-disable-next-line @typescript-eslint/naming-convention
	ciActionPath: string,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	workflowRef: string
	// eslint-disable-next-line @typescript-eslint/naming-convention
	distTag: string
	// eslint-disable-next-line @typescript-eslint/naming-convention
	repo: string
}

const CurrrentTags = (await RequestNpmPackageMetaData(Options.package))['dist-tags']
const DistTagFilePath = CreateDistTagFilePath()
Fs.writeFileSync(DistTagFilePath, JSON.stringify(CurrrentTags), { mode: 0o600 })
const OlderTags = await new HistoryManager({ Repo: Options.repo, GitHubToken: Options.ghToken, WorkflowRef: Options.workflowRef }).RequestHistory()
const PiscinaInstance = new Piscina({
	filename: TagWorkerFilename,
	maxThreads: Os.cpus().length
})

try {
	await Promise.all(Options.distTag.split(' ').filter(TargetTag => TargetTag.length > 0).map(TargetTag => PiscinaInstance.run({
		Package: Options.package,
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

	if (typeof process.env.GITHUB_ENV !== 'undefined') {
		Fs.appendFileSync(process.env.GITHUB_ENV, `DIST_TAG_FILE=${DistTagFilePath}${Os.EOL}`)
	}

	return DistTagFilePath
}
