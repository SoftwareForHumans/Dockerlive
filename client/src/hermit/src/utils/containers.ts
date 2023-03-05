import tar from 'tar-fs';
import Docker from 'dockerode';

import HermitOptions from './lib/HermitOptions';
import Syscall from './lib/Syscall';
import logger from './logger';
import { getNodeMajorVersion } from 'typescript';

const docker = new Docker();

export const buildImage = (options: HermitOptions) => new Promise<string>((resolve, reject) => {
  const imageTag = Math.random().toString(36).substr(2, 3)
    + Math.random().toString(36).substr(2, 3)
    + Math.random().toString(36).substr(2, 4);

  const tarDir = tar.pack(options.path);

  docker.buildImage(tarDir, { t: imageTag, dockerfile: 'Dockerfile.strace', q: true, forcerm: true }, (error, stream) => {
    if (error) {
      reject(error);
    }

    let imageId: string = "";

    if (stream) {
      stream.on('error', (error: Buffer) => {
        logger.error(error.toString());
      });

      stream.on('data', (dataBuffer: Buffer) => {
        try {
          const msg = JSON.parse(dataBuffer.toString())['stream'].replace("\n", "");
          logger.info(`Docker Message - ${msg}`);

          imageId = msg;
        }
        catch (_e) {
          logger.warn(`Container Stream - ${dataBuffer.toString()}`);
        }
      });

      stream.on('end', () => {
        resolve(imageTag);
      });
    }
    else {
      reject(Error('Failed to stream from the docker socket'));
    }
  });
});

export const createContainer = (imageId: string, cmd: string, options: HermitOptions, workdir: string) => new Promise<Docker.Container>((resolve, reject) => {
  docker.createContainer(
    {
      Image: imageId,
      HostConfig: { Binds: [`${options.path}:${workdir}`] },
      Cmd: (cmd == "") ? undefined : cmd.split(" ")
    },
    (error, container) => {
      if (error) {
        reject(error);
      }

      if (container) {
        resolve(container);

      }

      reject('The creation of the container failed');
    });
});

export const removeImage = (imageId: string) => docker.getImage(imageId).remove({ force: true });

export const extractPorts = async (container: Docker.Container) => {
  const inspectedData = await container.inspect();

  return Object.keys(inspectedData.NetworkSettings.Ports).map((port: string) => {
    return <Syscall>{
      syscall: 'bind',
      args: [
        18,
        { sa_family: null, sin6_port: { params: [port.split('/')[0]] }, sin_addr: null },
        16
      ],
      result: 0,
      timing: 0,
      pid: 21,
      type: 'SYSCALL'
    }

  });
}

// TODO: Discover container OS
// export const extractOS = async (imageId: string) => {}