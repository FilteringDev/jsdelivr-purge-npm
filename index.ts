import * as Actions from '@actions/core'
import * as ESToolkit from 'es-toolkit'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Zod from 'zod'
import { FilterArgumentsForOptions, ParseArgumentsAndOptions } from '@typescriptprime/parsing'
import { HistoryManager } from './sources/github.js'
import { FileManager } from './sources/file.js'
import { RequestNpmPackageMetaData } from './sources/npm-api.js'
import { PurgeRequestManager } from './sources/requests.js'

const RawCLIOptionsSchema = Zod.strictObject({
  ghToken: Zod.string().optional(),
  package: Zod.string().optional(),
  ciWorkspacePath: Zod.string().optional(),
  ciActionPath: Zod.string().optional(),
  workflowRef: Zod.string().optional(),
  distTag: Zod.string().optional(),
  repo: Zod.string().optional()
}).partial()

type IRawCLIOptions = Zod.infer<typeof RawCLIOptionsSchema>

type IRuntimeOptions = {
  GhToken: string
  Package: string
  CiWorkspacePath: string
  WorkflowRef: string
  DistTag: string
  Repo: string
}

function ResolveStringOption(...Values: Array<string | boolean | undefined>): string {
  return Values.find((Value): Value is string => typeof Value === 'string' && Value.length > 0) ?? ''
}

function RequireStringOption(Value: string, OptionName: string): string {
  if (Value.length === 0) {
    throw new Error(OptionName + ' is required')
  }

  return Value
}

async function ResolveOptions(): Promise<IRuntimeOptions> {
  const ParsedCLIArguments = await ParseArgumentsAndOptions<Record<string, string | boolean>>(
    FilterArgumentsForOptions(process.argv),
    {
      NamingConvention: ESToolkit.camelCase
    }
  )

  const ParsedCLIOptions = RawCLIOptionsSchema.parse(ParsedCLIArguments.Options) as IRawCLIOptions

  return {
    GhToken: ResolveStringOption(
      ParsedCLIOptions.ghToken,
      process.env.GITHUB_TOKEN,
      process.env.GH_TOKEN
    ),
    Package: RequireStringOption(
      ResolveStringOption(ParsedCLIOptions.package, process.env.PACKAGE),
      '--package or PACKAGE'
    ),
    CiWorkspacePath: ResolveStringOption(
      ParsedCLIOptions.ciWorkspacePath,
      process.env.CI_WORKSPACE_PATH,
      process.cwd()
    ),
    WorkflowRef: ResolveStringOption(
      ParsedCLIOptions.workflowRef,
      process.env.WORKFLOW_REF,
      process.env.WORKFLOWREF
    ),
    DistTag: RequireStringOption(
      ResolveStringOption(
        ParsedCLIOptions.distTag,
        process.env.DIST_TAG,
        process.env.DISTTAG
      ),
      '--dist-tag or DISTTAG'
    ),
    Repo: RequireStringOption(
      ResolveStringOption(
        ParsedCLIOptions.repo,
        process.env.REPO,
        process.env.GITHUB_REPOSITORY
      ),
      '--repo or REPO'
    )
  }
}

async function Main(): Promise<void> {
  const Options = await ResolveOptions()
  const CPUModel = Os.cpus()[0]?.model ?? 'Unknown CPU'

  Actions.info('Running on ' + CPUModel + ' with ' + Os.availableParallelism() + ' threads/vCPUs.')

  const CurrentTags = (await RequestNpmPackageMetaData(Options.Package))['dist-tags']
  await Fs.writeFile('/tmp/dist-tag.json', JSON.stringify(CurrentTags))

  const OlderTags = await new HistoryManager({
    Repo: Options.Repo,
    GitHubToken: Options.GhToken,
    WorkflowRef: Options.WorkflowRef
  }).RequestHistory()

  const TargetTags = Options.DistTag.split(/\s+/).filter(Boolean)

  await Promise.all(TargetTags.map(async (TargetTag) => {
    const CurrentVersion = CurrentTags[TargetTag]

    if (typeof CurrentVersion !== 'string') {
      throw new Error('dist-tag not found: ' + TargetTag)
    }

    const PreviousVersion = OlderTags?.[TargetTag]
    const Versions = PreviousVersion === CurrentVersion
      ? { A: CurrentVersion }
      : { A: CurrentVersion, B: PreviousVersion }

    const ChangedFiles = await new FileManager(
      Options.Package,
      Versions,
      Options.CiWorkspacePath + '/' + TargetTag
    ).Union()

    if (ChangedFiles.length === 0) {
      Actions.info('No files changed for dist-tag ' + TargetTag)
      return
    }

    const PurgeRequestManagerInstance = new PurgeRequestManager(Options.Package)
    PurgeRequestManagerInstance.AddURLs(ChangedFiles, TargetTag)
    await PurgeRequestManagerInstance.Start()
  }))
}

await Main()
