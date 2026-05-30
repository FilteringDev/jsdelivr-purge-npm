import { ProcessPurgeBatch, type PurgeWorkerDataType } from './requests.js'

export default async function PurgeWorker(TaskData: PurgeWorkerDataType): Promise<void> {
	await ProcessPurgeBatch(TaskData)
}
