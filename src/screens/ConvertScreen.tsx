import {useCallback, useEffect, useRef, useState} from 'react';
import {DropZone} from '../components/DropZone';
import {ConversionQueue, type QueueItem} from '../components/ConversionQueue';
import {enqueueConversion, getParallelism, type JobUpdate, type OutputFormat, subscribeToProgress, getDefaultFormat, detectFileType} from '../lib/media';

function basename(path: string) {
  return path.split(/[\/]/).pop() || path;
}

function outputForConvert(path: string, format: OutputFormat) {
  const clean = path.replace(/\.[^./\\]*$/, '');
  return `${clean}-converted.${format}`;
}

export function ConvertScreen() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [parallelism, setParallelism] = useState(1);
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const jobPathsRef = useRef(jobPaths);
  const pendingUpdates = useRef<Record<string, JobUpdate>>({});

  useEffect(() => {
    jobPathsRef.current = jobPaths;
  }, [jobPaths]);

  useEffect(() => {
    getParallelism()
      .then(setParallelism)
      .catch(() => {
      });

    let unlisten: (() => void) | undefined;
    let active = true;

    subscribeToProgress((update: JobUpdate) => {
      const path = jobPathsRef.current[update.id];
      if (!path) {
        pendingUpdates.current[update.id] = update;
        return;
      }

      setItems((all) => all.map((i) => i.path === path ? {
        ...i,
        status: update.status,
        progress: update.progress,
        error: update.error ?? undefined
      } : i));
    })
      .then((fn) => {
        if (active) unlisten = fn; else fn();
      })
      .catch((e) => {
        console.log(e)
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const addFilesConvert = useCallback((paths: string[]) => setItems((previous) => {
    const existing = new Set(previous.map((item) => item.path));
    return [...previous, ...paths.filter((path) => !existing.has(path)).map((path) => ({
      path,
      name: basename(path),
      format: getDefaultFormat(detectFileType(path)),
      quality: 23,
      status: 'ready' as const,
      progress: 0
    }))];
  }), []);

  const changeConvert = useCallback((path: string, patch: Partial<QueueItem>) => setItems((all) => all.map((item) => item.path === path ? {...item, ...patch} : item)), []);

  const convert = useCallback(async (item: QueueItem) => {
    try {
      const outputPath = outputForConvert(item.path, item.format);
      const id = await enqueueConversion({
        inputPath: item.path,
        outputPath,
        format: item.format,
        quality: item.quality,
        preserveMetadata: true
      });

      jobPathsRef.current = {...jobPathsRef.current, [id]: item.path};
      setJobPaths(jobPathsRef.current);

      const early = pendingUpdates.current[id];
      if (early) {
        delete pendingUpdates.current[id];
        changeConvert(item.path, {status: early.status, progress: early.progress, error: early.error ?? undefined});
      } else changeConvert(item.path, {status: 'running', progress: 0, error: undefined});
    } catch (error) {
      changeConvert(item.path, {status: 'failed', error: String(error)});
    }
  }, [changeConvert]);

  const removeItemConvert = useCallback((path: string) => {
    setItems((all) => all.filter((item) => item.path !== path));
  }, []);

  const removeCompletedConvert = useCallback(() => {
    setItems((all) => all.filter((item) => item.status !== 'completed'));
  }, []);

  const clearQueueConvert = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-xl font-bold tracking-tight">Converti</h1>
        <p className="text-sm text-zinc-500">Converti file in diversi formati</p>
      </header>
      <DropZone onFiles={addFilesConvert}/>
      <ConversionQueue
        items={items}
        onChange={changeConvert}
        onConvert={convert}
        parallelism={parallelism}
        onRemove={removeItemConvert}
        onRemoveCompleted={removeCompletedConvert}
        onClear={clearQueueConvert}
      />
    </>
  );
}
