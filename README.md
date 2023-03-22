# Dockerlive

Live programming environment for Dockerfiles.

## DISCLAIMER

This is an early version which is still under development. As such, some features may be unstable.

Developed within the scope of the final thesis of a MSc in Informatics and Computer Engineering.

## REQUIREMENTS

- [Docker Engine](https://www.docker.com/) (>= v19.03.0)
- [Nmap](https://nmap.org/)

Nmap is optional. If present in the system, the extension can perform automatic service discovery on the test container.

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
- [Hermit Crab Icon](https://www.flaticon.com/free-icons/hermit-crab) by [Freepik](https://www.flaticon.com/authors/freepik) on [Flaticon](https://www.flaticon.com/)

## TELEMETRY

Dockerlive collects usage data using Azure Application Insights in order to help better understand the usage of the extension. If you don’t wish to send usage data, you can set the telemetry.enableTelemetry setting to false. `Telemetry.md` contains a full description of the gathered data.