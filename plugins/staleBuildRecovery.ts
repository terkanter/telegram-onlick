import type { Plugin } from 'vite';

type Options = {
  buildEntryFile: string;
};

// Service workers of gateway builds that have no stale build check. A browser re-fetches a registered
// worker by its own URL, so a replacement served there is the only way to reach a page stuck on such a build.
const STALE_SERVICE_WORKER_FILES = [
  'service.worker-CGmG7JH4.js',
  'service.worker-zbpWPhUz.js',
  'service.worker-Dyne26S0.js',
];
// Activates at once and has no `fetch` handler. The stale page reloads on `controllerchange`, gets the
// current build from the network and registers the current worker, which clears the asset cache.
const REPLACEMENT_SERVICE_WORKER_SOURCE = 'self.oninstall = () => self.skipWaiting();\n';

export default function buildStaleBuildRecoveryPlugin({ buildEntryFile }: Options): Plugin {
  return {
    name: 'stale-build-recovery',
    apply: 'build',
    generateBundle(_outputOptions, bundle) {
      const entryChunk = Object.values(bundle).find((output) => output.type === 'chunk' && output.isEntry);
      if (!entryChunk) {
        this.error('The bundle has no entry chunk');
      }

      // The page compares this name with its own entry script to detect a stale build
      this.emitFile({ type: 'asset', fileName: buildEntryFile, source: entryChunk.fileName });

      STALE_SERVICE_WORKER_FILES.forEach((fileName) => {
        if (bundle[fileName]) {
          this.error(`The current service worker has the name of a stale one: ${fileName}`);
        }

        this.emitFile({ type: 'asset', fileName, source: REPLACEMENT_SERVICE_WORKER_SOURCE });
      });
    },
  };
}
