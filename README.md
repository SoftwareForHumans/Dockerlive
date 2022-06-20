# Dockerlive

Live programming environment for Dockerfiles.

## DISCLAIMER

This is an early version which is still under development. As such, some features may be unstable.

Developed within the scope of the final thesis of a MSc in Informatics and Computer Engineering.

## REQUIREMENTS

- [Docker Engine](https://www.docker.com/) (>= v19.03.0)
- [Nmap](https://nmap.org/)

Nmap is optional. If present in the system, the extension can perform automatic service discovery on the test container.

### VSCode and Docker error

When attempting to list the different Docker containers and images while also connect to the Docker registry after installing VS Code and the Docker VS Code extension, on Linux the VS Code extension can report an error - connect EACCES /var/run/docker.sock. This error is to be expected while executing Docker as a non-root user in Linux. After installing Docker on Linux and connecting to it as a non-root user, there are a few post-installation actions listed under "Manage Docker as a non-root user." This error is easely fixed with a few instructions.

The first command is to create a docker group.

```batch
sudo groupadd docker
```

It's possible that this isn't required because the Docker group can be created automatically when installing Docker on Ubuntu 20.04.

The second command is to add my user to the docker group, which will be necessary.

```batch
sudo usermod -aG docker $USER
```

After this commands you need to log out and log back in so that your group membership is re-evaluated, but to be sure restar the computer for the changes to take effect. To activate the changes to groups on Linux, do the following command:

```batch
newgrp docker
```

## FEATURES

Automatically build, run, perform tests and provide feedback during the creation of a Dockerfile.

Feedback generated:

- Image build errors
- Container runtime errors
- Changes to environment variables
- Container running processes
- Container performance statistics (CPU, Memory, Network, I/O)
- Base image OS information
- Layer size
- Layer build time
- Explore each layer's filesystem (highlighting the changes of each layer)
- Service discovery (with Nmap)

## CREDITS

- [Docker Icon](https://iconscout.com/icons/docker) by [Icons8](https://iconscout.com/contributors/icons8) on [Iconscout](Iconscout)
- [Arrow Icon](https://iconscout.com/icons/arrow) by [Mohit Gandhi](https://iconscout.com/contributors/mcgandhi61) on [Iconscout](Iconscout)

## TELEMETRY

Dockerlive collects usage data using Azure Application Insights in order to help better understand the usage of the extension. If you don’t wish to send usage data, you can set the telemetry.enableTelemetry setting to false. `Telemetry.md` contains a full description of the gathered data.
