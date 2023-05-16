"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_root_path_1 = __importDefault(require("app-root-path")); // app root 경로를 가져오는 lib
const winston_1 = __importDefault(require("winston")); // winston lib
const process_1 = __importDefault(require("process"));
const { combine, timestamp, label, printf } = winston_1.default.format;
const myFormat = printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${label}] ${level}: ${message}`; // log 출력 포맷 정의
});
const options = {
    // log파일
    file: {
        level: "info",
        filename: `${app_root_path_1.default}/logs/winston-test.log`,
        handleExceptions: true,
        json: false,
        maxsize: 5242880,
        maxFiles: 5,
        colorize: false,
        format: combine(label({ label: "winston-test" }), timestamp(), myFormat // log 출력 포맷
        ),
    },
    // 개발 시 console에 출력
    console: {
        level: "debug",
        handleExceptions: true,
        json: false,
        colorize: true,
        format: combine(label({ label: "nba_express" }), timestamp(), myFormat),
    },
};
let logger = winston_1.default.createLogger({
    transports: [
        new winston_1.default.transports.File(options.file), // 중요! 위에서 선언한 option으로 로그 파일 관리 모듈 transport
    ],
    exitOnError: false,
});
if (process_1.default.env.NODE_ENV !== "production") {
    logger.add(new winston_1.default.transports.Console(options.console)); // 개발 시 console로도 출력
}
exports.default = logger;
