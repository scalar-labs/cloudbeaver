<img src="https://github.com/dbeaver/cloudbeaver/wiki/images/cloudbeaver-logo.png" alt="CloudBeaver logo" align="right" width="250"/>

# CloudBeaver Community Edition with Support for ScalarDB

CloudBeaver is a light modern web-application for the database management. Out-of-the-box CloudBeaver supports various SQL, NoSQL and BigData data sources. This repository provides a forked version that supports ScalarDB and is free to use and open-source (licensed under [Apache 2](https://github.com/dbeaver/cloudbeaver/blob/devel/LICENSE) license). See the original [repository](https://github.com/dbeaver/cloudbeaver/) and [WIKI](https://github.com/dbeaver/cloudbeaver/wiki) for more details about CloudBeaver.

<a><img src="./docs/images/connection-creation-demo.png" width="400"/></a>
<img src="./docs/images/data-editor-demo.png" width="400"/>
<img src="./docs/images/sql-editor-demo.png" width="400"/>
<img src="./docs/images/data-transfer-demo.png" width="400"/>

## Run in Docker

1. Prepare a client configuration file to connect ScalarDB Cluster. For details about the configuration, see [Client Configurations](https://scalardb.scalar-labs.com/docs/latest/scalardb-cluster/scalardb-cluster-configurations/#client-configurations).

1. Prepare a docker compose file and map the above configuration file to `/etc/scalardb.properties`. 

   ```yaml
   services:
     cloudbeaver:
       image: ghcr.io/scalar-labs/cloudbeaver:latest
       ports:
         - 8978:8978
       volumes:
         - ./workspace:/opt/cloudbeaver/workspace
         - ./scalardb.properties:/etc/scalardb.properties
   ```

1. Run the docker container

   ```console
   docker compose up -d
   ```

## How to access ScalarDB through CloudBeaver

- Once CloudBeaver is running, access http://localhost:8978/ and complete the setup based on [Administration](https://github.com/dbeaver/cloudbeaver/wiki/Administration).
- When creating a new connection setting, you will see ScalarDB in the database list and select it.
- Keep the file path in the Host field as is in the connection setting, and only change the Connection name as desired.
- If prompted for credentials when establishing the connection, input a username and a password of a ScalarDB user. You can leave them empty if authentication is disabled or they are specified in the configuration file.

## Known Limitations

- The cross-partition scan must be enabled to view records in [Data editor](https://github.com/dbeaver/cloudbeaver/wiki/Data-editor). It is enabled by default; however, using it in a production environment is not recommended for non-JDBC databases due to potential consistency issues. For details, see [SELECT](https://scalardb.scalar-labs.com/docs/latest/scalardb-sql/grammar/#select) in [ScalarDB SQL Grammar](https://scalardb.scalar-labs.com/docs/latest/scalardb-sql/grammar/).
- [Data editor](https://github.com/dbeaver/cloudbeaver/wiki/Data-editor) supports viewing data, but only inserting new rows is supported for modifications; updating and deleting existing rows are not supported. Additionally, integers can only be inserted if they are of `BigInt` type.
- Due to a limitation in how CloudBeaver's SQL editor parses scripts, [BEGIN](https://scalardb.scalar-labs.com/docs/latest/scalardb-sql/grammar#begin) may not work as expected when executing multiple statements. Use [START TRANSACTION](https://scalardb.scalar-labs.com/docs/latest/scalardb-sql/grammar#start-transaction instead), which is the SQL-standard command, instead.
- Data in the `DATE` and `TIME` type columns cannot be displayed, although you can insert data correctly.
