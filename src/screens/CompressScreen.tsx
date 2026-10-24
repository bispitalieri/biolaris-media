import {useCallback, useEffect, useRef, useState} from 'react';
import {DropZone} from '../components/DropZone';
import {CompressionQueue, type CompressionQueueItem} from '../components/CompressionQueue';
import {enqueueCompression, getParallelism, type JobUpdate, subscribeToProgress} from '../lib/media';

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function outputForCompress(path: string) {
  const clean = path.replace(/\.[^./\\]*$/, '');
  return `${clean}-compressed${path.match(/\.[^./\\]*$/)?.[0] || ''}`;
}

export function CompressScreen() {
  const [compressItems, setCompressItems] = useState<CompressionQueueItem[]>([]);
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

      setCompressItems((all) => all.map((i) => i.path === path ? {
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

  const addFilesCompress = useCallback((paths: string[]) => setCompressItems((previous) => {
    const existing = new Set(previous.map((item) => item.path));
    return [...previous, ...paths.filter((path) => !existing.has(path)).map((path) => ({
      path,
      name: basename(path),
      quality: 50 as const,
      status: 'ready' as const,
      progress: 0
    }))];
  }), []);

  const changeCompress = useCallback((path: string, patch: Partial<CompressionQueueItem>) => setCompressItems((all) => all.map((item) => item.path === path ? {...item, ...patch} : item)), []);

  const compress = useCallback(async (item: CompressionQueueItem) => {
    try {
      const outputPath = outputForCompress(item.path);
      const id = await enqueueCompression({
        inputPath: item.path,
        outputPath,
        quality: item.quality,
        preserveMetadata: true
      });

      jobPathsRef.current = {...jobPathsRef.current, [id]: item.path};
      setJobPaths(jobPathsRef.current);

      const early = pendingUpdates.current[id];
      if (early) {
        delete pendingUpdates.current[id];
        changeCompress(item.path, {status: early.status, progress: early.progress, error: early.error ?? undefined});
      } else changeCompress(item.path, {status: 'running', progress: 0, error: undefined});
    } catch (error) {
      changeCompress(item.path, {status: 'failed', error: String(error)});
    }
  }, [changeCompress]);

  const removeItemCompress = useCallback((path: string) => {
    setCompressItems((all) => all.filter((item) => item.path !== path));
  }, []);

  const removeCompletedCompress = useCallback(() => {
    setCompressItems((all) => all.filter((item) => item.status !== 'completed'));
  }, []);

  const clearQueueCompress = useCallback(() => {
    setCompressItems([]);
  }, []);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-xl font-bold tracking-tight">Comprimi</h1>
        <p className="text-sm text-zinc-500">Comprimi file per ridurne le dimensioni</p>
      </header>
      <DropZone onFiles={addFilesCompress}/>
      <CompressionQueue
        items={compressItems}
        onChange={changeCompress}
        onCompress={compress}
        parallelism={parallelism}
        onRemove={removeItemCompress}
        onRemoveCompleted={removeCompletedCompress}
        onClear={clearQueueCompress}
      />
    </>
  );
}
