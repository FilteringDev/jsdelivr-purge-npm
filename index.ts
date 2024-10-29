import * as Commander from 'commander'
import * as Actions from '@actions/core'
import * as Os from 'node:os'
import * as Fs from 'node:fs'
import PLimit from 'p-limit'
import { RequestNpmPackageMetaData } from './sources/npm-api.js'
import { HistoryManager } from './sources/github.js'
import { PurgeRequestManager } from './sources/requests.js'
import { FileManager } from './sources/file.js'

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
Fs.writeFileSync('/tmp/dist-tag.json', JSON.stringify(CurrrentTags))
const OlderTags = await new HistoryManager({ Repo: Options.repo, GitHubToken: Options.ghToken, WorkflowRef: Options.workflowRef }).RequestHistory()

const PLimitInstance = PLimit(Os.cpus().length)
const PLimitJobs: Promise<void>[] = []
for (const TargetTag of Options.distTag.split(' ')) {
	PLimitJobs.push(PLimitInstance(async () => {
		const ChangedFiles = await new FileManager(Options.package, { A: CurrrentTags[TargetTag], B: OlderTags === null ? undefined : OlderTags[TargetTag] }, `${Options.ciWorkspacePath}/${TargetTag}`).Union()
		const PurgeRequestManagerInstance = new PurgeRequestManager(Options.repo)
		PurgeRequestManagerInstance.AddURLs(ChangedFiles, TargetTag)
		PurgeRequestManagerInstance.Start()
	}))
}

await Promise.all(PLimitJobs)