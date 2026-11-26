import type { Tracker } from "highseat/server"
import { createTestTracker } from "highseat/testing"
import type { TrackedEvent } from "highseat/testing"

// The test tracker is a `Tracker`, so site code takes it unchanged.
const tracker = createTestTracker()
const asTracker: Tracker = tracker

asTracker.track("file_download", { url: "https://example.com/guide.pdf" })

// Without strict mode any name records, with any properties.
tracker.track("report_exported", { format: "csv" })

// A built-in event's properties keep their declared type.
const download: TrackedEvent<"file_download"> | undefined = tracker.getEvents("file_download")[0]
const url: string | undefined = download?.properties.url

// @ts-expect-error A built-in event's properties are checked by the test tracker too.
tracker.track("file_download", { href: "https://example.com/guide.pdf" })

// @ts-expect-error The record is the test's to read, not to replace.
tracker.events = []

void url
