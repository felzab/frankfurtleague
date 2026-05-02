#!/bin/bash

docker build -t 'felzab/digi:frontend' ./digi_frontend
docker build -t 'felzab/digi:backend' ./digi_backend

docker push felzab/digi:frontend
+docker push felzab/digi:backend