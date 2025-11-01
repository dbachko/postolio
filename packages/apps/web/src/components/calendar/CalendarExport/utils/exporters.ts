type ExporterModule = typeof import('../../../../utils/calendar-export');

let modulePromise: Promise<ExporterModule> | null = null;

export function loadExporters(): Promise<ExporterModule> {
  if (!modulePromise) {
    modulePromise = import('../../../../utils/calendar-export');
  }

  return modulePromise;
}
