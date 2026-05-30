import { FileManager } from './file.js'
import { PurgeRequestManager } from './requests.js'
import type { TagWorkerDataType } from '../index.js'

export default async function TagWorker(TaskData: TagWorkerDataType): Promise<void> {
	const CurrentVersion = TaskData.CurrentTags[TaskData.TargetTag]

	if (typeof CurrentVersion === 'undefined') {
		throw new Error(`Unknown npm dist-tag: ${TaskData.TargetTag}`)
	}

	const ChangedFiles = await new FileManager(TaskData.Package, {
		A: CurrentVersion,
		B: TaskData.OlderTags === null ? undefined : TaskData.OlderTags[TaskData.TargetTag]
	}).Union()
	const PurgeRequestManagerInstance = new PurgeRequestManager(TaskData.Package)
	PurgeRequestManagerInstance.AddURLs(ChangedFiles, TaskData.TargetTag)
	await PurgeRequestManagerInstance.Start()
}
