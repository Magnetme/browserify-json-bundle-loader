/**
 * Module loader script.
 * This is a wrapper around the browserify-prelude function with support for intelligent updating of scripts.
 * It keeps track of the version already downloaded to the user's pc (localstorage) and explicitely
 * requests the server for a changeset. It will then update it's module cache with the changes.
 *
 * TODOs:
 * - [ ] If diff fails & cannot download latest, use from cache (configurable?)
 *       the correct diff.
 * - [ ] Expose a function that enables the user code to invalidate the cache.
 */
function loadBundle(opts) {
	opts.storage = opts.storage || window.localStorage;
	opts.storageKey = opts.storageKey || '__bundle';
	//--START IMPORT PRELUDE-- TODO: don't copy-paste
	// Save the require from previous bundle to this closure if any
	function outer (modules, cache, entry) {
		var previousRequire = typeof require == "function" && require;
		function newRequire(name, jumped){
			if(!cache[name]) {
				if(!modules[name]) {
					// if we cannot find the the module within our internal map or
					// cache jump to the current global require ie. the last bundle
					// that was added to the page.
					var currentRequire = typeof require == "function" && require;
					if (!jumped && currentRequire) return currentRequire(name, true);
					// If there are other bundles on this page the require from the
					// previous one is saved to 'previousRequire'. Repeat this as
					// many times as there are bundles until the module is found or
					// we exhaust the require chain.
					if (previousRequire) return previousRequire(name, true);
					throw new Error('Cannot find module \'' + name + '\'');
				}
				var m = cache[name] = {exports:{}};
				modules[name][0].call(m.exports, function(x){
					var id = modules[name][1][x];
					return newRequire(id ? id : x);
				},m,m.exports,outer,modules,cache,entry);
			}
			return cache[name].exports;
		}
		for(var i=0;i<entry.length;i++) newRequire(entry[i]);
	}
	//---END IMPORT PRELUDE---


	//This regex result in the following matches:
	//[0] entire module (= full match)
	//[1] function parameters (without enclosing brackets)
	//[2] function body (without enclosing parenthesis)
	var functionMatcher = /^function(?:.*?)\((.*?)\)\s*{((?:.|\n)*)}$/m;
	/**
	 * This function deserializes a module function such that it can both be run and debugged.
	 *
	 * @param {String} moduleString - The string containing the module function.
	 * @param {String} name - The name of the module
	 * @return {Function} The module function.
	 */
	function deserializeModuleFunction(moduleString, name) {
		var sourceURL = window.location.href + name;
		sourceURL = sourceURL.replace(/\/+/g, '/');

		//We could use eval to quickly evaluate the module, but that's a bit unsafe. Therefore we
		//construct a function instead. Still unsafe, but a bit less than eval.
		//This does require the modulestring to obey a few constraints:
		//- The module must be exactly one function.
		//- The function cannot be enclosed in anything. That is, the string must begin with
		//  "function(<params>){" and end with "}"
		//- The function signature cannot contain any newlines (leading is ok, that's trimmed)
		moduleString = moduleString.trim();
		var matches = moduleString.match(functionMatcher);
		var params = matches[1].split(",").map(function(param) {
			return param.trim();
		});
		var body = matches[2].trim();
		//Only add the sourceURL if there isn't already one. We don't want to mess with the debugger.
		if (!body.match(/\/\/#\s*sourceURL=/)) {
			body += "\n\/\/# sourceURL=" + sourceURL;
		}
		return new Function(params, body);
	}

	/**
	 * Deserialize an entire bundle
	 *
	 * @param {String} bundle - A JSON bundle string (e.g. from cache)
	 * @return {Object} A deserialized bundle object.
	 */
	function deserializeBundle(bundle) {
		bundle = JSON.parse(bundle);
		var deserializedModules = {};
		for (var name in bundle.modules) {
			var module = bundle.modules[name];
			var moduleFunction = deserializeModuleFunction(module[0], name);
			var moduleDeps = module[1];
			deserializedModules[name] = [ moduleFunction, moduleDeps ];
		}
		bundle.modules = deserializedModules;
		return bundle;
	}

	/**
	 * Fetches a bundle.
	 *
	 * @param {String} url - The url to fetch the bundle from
	 * @param {(String, Object) -> any} - A node-style callback function that will be called with the
	 *                                    (deserialized) bundle on success.
	 */
	function fetchBundle(url, cb) {
		var feyenoord = new XMLHttpRequest();
		feyenoord.addEventListener('readystatechange', function() {
			if (feyenoord.readyState === 4) {
				if (feyenoord.status === 200) {
					var modules = deserializeBundle(feyenoord.responseText);
					cb(null, modules);
				} else {
					cb(new Error("Could not fetch bundle. Status code: " + feyenoord.status));
				}
			}
		});
		feyenoord.open('GET', url, true);
		feyenoord.send();
	}

	/**
	 * Updates the cache with a new bundle.
	 *
	 * @param {Object} bundle - The bundle to store in cache
	 */
	function updateCache(bundle) {
		opts.storage.setItem(opts.storageKey, JSON.stringify(bundle, function serializer(key, value) {
			if (typeof value === 'function') {
				return  value.toString();
			}
			return value;
		}));
	}

	/**
	 * Updates a bundle by fetching the diff from the server and applying it against the base bundle.
	 *
	 * @param {Object} opts - The options for the loader.
	 * @param {Object} bundle - A base bundle
	 * @param {(String, Object) -> any} cb - A node style callback function that will be called with
	 *                                       the new bundle on success.
	 */
	function updateBundle(opts, bundle, cb) {
		var url;
		//If there is no diff url or base version then we just load the full version again
		if (opts.diffUrl && bundle.version) {
			url = opts.diffUrl.replace('%v', bundle.version);
		} else {
			url = opts.sourceUrl;
		}
		fetchBundle(url, function(err, diff) {
			if (err) return cb(err);
			if (!diff.version && diff.from !== bundle.version) {
				throw new Error("Received diff since version " + diff.from + ", but requested diff since version " + bundle.version);
			}
			bundle.version = diff.to || diff.version; //diffs use to, full bundles use version
			bundle.entry = diff.entry || bundle.entry;
			for (var name in diff.modules) {
				//if a module is null than it means it has been removed from the bundle. Thus, we need
				//to delete it as well. Simply setting it to null will lead to "storage leaks", since it
				//will then still be serialized.
				if (!diff.modules[name]) {
					delete bundle.modules[name];
				} else {
					bundle.modules[name] = diff.modules[name];
				}
			}
			cb(null, bundle);
		});
	}

	/**
	 * Starts the application contained in the bundle.
	 * @param {Object} bundle - The bundle to launch.
	 */
	function start(bundle) {
		outer(bundle.modules, {}, bundle.entry);
	}

	function bundleFetchCallback(err, bundle) {
		if (err) throw err;
		updateCache(bundle);
		start(bundle);
	}
	/**
	 * Initializes the entire application.
	 * It fetches the latest version, applies diffs when necessary, and then starts the application.
	 */
	function initialize() {
		var bundle;
		try {
			bundle = opts.storage.getItem(opts.storageKey);
		} catch (e) {} //ignore errors, we just reload the entire bundle when it fails to retrieve it from storage
		if (bundle) {
			bundle = deserializeBundle(bundle);
			updateBundle(opts, bundle, bundleFetchCallback);
		} else {
			fetchBundle(opts.sourceUrl, bundleFetchCallback);
		}
	}

	initialize();
}

//Export the module if we're used as a CommonJS module.
if (typeof module === 'object') module.exports = loadBundle;
