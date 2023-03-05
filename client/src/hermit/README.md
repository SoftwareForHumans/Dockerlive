# Hermit
A tool to automatically generate dockerfiles for projects. Just like hermit crabs try to grab the shells that perfectly fit its bodies, being neither to large or to small, `hermit` writes suitable dockerfiles for existing software

## Dependencies
  * [`Node.js`](https://nodejs.org/): JavaScript runtime environment
  * [`npm`](https://www.npmjs.com/get-npm): Node Package Manager
  * [`strace`](https://strace.io/): System calls tracker, and usually comes installed in the majority of Linux distributions by default.
  * [`grep`](): To filter only relevant information, and comes installed by default in all Unix-like Operating Systems.

## Install Node Modules
Run in the root of the project:
```bash
npm install
```

## Install hermit in the system
Run in the root of the project:
```bash
npm run install-hermit
```

## How to run hermit
It is required first to have installed with the previous command. `hermit` can be run in any directory.

Run (in any directory):
```bash
hermit [OPTIONS] <service_command>
```

The directory `tmp/` will be generated in the current directory, where `hermit` is being executed.


## How to run (from the root of the source code)
Run in the root of the project:
```bash
npm start -- [OPTIONS] <service_command>
```
Where `<service_command>` is the command to start the service, that is intended to be containerized. In the case of multiple words, the command should be inside parenthesis, like this `"<command_with_multiple_words>"`.

If the service is not set in the `PATH` environment variable, relative or absolutes paths work too.

A directory named `tmp/`, containing temporary files, will be generated in the root of the repository.

## Compile to JavaScript
While the previous command, does both compilation and execution, this command only compiles.

Run in the root of the project:
```bash
npm run build
```
The compiled JavaScript code would be located in the `dist/` directory.

## How to run compiled Javascript code
It is required first to have compiled with the previous command. This scenario offers the advantage of running the tool in any directory, while with `npm start` it is mandatory to be in the root of the project.

Run (in any directory):
```bash
node /path/to/root/dist/bin/cli.js [OPTIONS] <service_command>
```

This time the directory `tmp/` will be generated in the current directory, where the tool is being executed.

## Current Limitations
  * At the moment, only works in debian-based linux distributions like Ubuntu or Debian itself.
  * Users must supply to hermit the command to run the service.
