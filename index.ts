import * as Commander from 'commander'
import * as Actions from '@actions/core'
import * as Os from 'node:os'
import * as Fs from 'node:fs'
import { RequestNpmPackageMetaData } from './sources/npm-api.js'

Actions.info(`Running on ${Os.cpus()[0].model} with ${Os.cpus().length} threads/vCPUs.`)

const Program = new Commander.Command()

// Set options.
Program.option('--gh-token <TOKEN>', 'GitHub token', '')
	.option('--package <package>', 'A npm package. eg: owner/repo', '')
	.option('--ci-workspace-path <PATH>', 'A path to the CI workspace.', '')
	.option('--ci-action-path <PATH>', 'A path to the CI action.', '')

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
	ciActionPath: string
}

const NpmPackageMeta = await RequestNpmPackageMetaData(Options.package)
const NpmPackageLatest = NpmPackageMeta['dist-tags'].latest

for (const )