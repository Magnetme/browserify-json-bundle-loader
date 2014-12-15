Module loader for browserify-json-bundles and diffs.

On first run this module loader will fetch a full browserify-json-bundle from a configurable url. It will cache all modules, and on successive loads it will only fetch a json-bundle-diff. This allow for very lightweight requests, and thus fast loading of functionality. If no base version of diff url is given it will just fetch the full bundle on successive loads.

This module works both from a CommonJS context and directly on the window object.

This module is part of the [browserify-diff](https://github.com/Magnetme/browserify-diff) project.

## Methods
### loadBundle(opts)
Loads, updates and starts the bundle.

**parameters**
- opts.sourceUrl - The URL where the full version of the bundle is available. This should be the latest version, the bundle will not fetch a diff after downloading the full version.
- [opts.sourceRoot] - The root path of the sources. This will be used to create the `sourceURL` url, but is not used to actually fetch scripts. Defaults to `window.location.href`.
- [opts.diffUrl] - A URL where diffs can be fetched from. The url must contain '%v', which will be replaced with the version of the cached bundle. If this URL is not provided the full bundle will be downloaded on every load. This URL should return a valid browserify-json-bundle-diff, such as those created by the [browserify-json-bundle-diff](https://github.com/Magnetme/browserify-json-bundle-diff) project.
- [opts.storage] - An object that implements the DOM Storage interface. This will be used to cache the bundles and defaults to `window.localStorage`.
- [opts.storageKey] - The key that will be used for caching the bundle. Defaults to `__bundle`.
