import { DownloadRepoVersionTask, type FileDownloadWorkerDataType } from './file.js'

export default async function FileWorker(TaskData: FileDownloadWorkerDataType): Promise<void> {
  await DownloadRepoVersionTask(TaskData)
}
