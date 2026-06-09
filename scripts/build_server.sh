#!/bin/bash

docker build -t 'felzab/frankfurtleague:frontend' ./fl_frontend
docker build -t 'felzab/frankfurtleague:backend' ./fl_backend

docker push felzab/frankfurtleague:frontend
docker push felzab/frankfurtleague:backend
