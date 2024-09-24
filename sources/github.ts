import * as GitHub from '@octokit/rest'

export type IHistoryManagerDataJSON = Record<string, string>

export class HistoryManager {
  private GitHubInstance: InstanceType<typeof GitHub.Octokit> = null

  constructor(private readonly Config: { GitHubToken: string, WorkflowRef: string, DistTags: string }) {
    this.GitHubInstance = new GitHub.Octokit({ auth: this.Config.GitHubToken })
  }
}