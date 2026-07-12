'use strict';

process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.PORT = process.env.PORT || '3000';
process.env.WDS_SOCKET_HOST = process.env.WDS_SOCKET_HOST || '127.0.0.1';
process.env.WDS_SOCKET_PORT = process.env.WDS_SOCKET_PORT || '3000';
process.env.WDS_SOCKET_PATH = process.env.WDS_SOCKET_PATH || '/ws';

require('../node_modules/react-scripts/scripts/start');
