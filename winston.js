"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston")); // winston lib
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file")); // winston lib
const process_1 = __importDefault(require("process"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const appendTimestamp = winston_1.default.format((info, opts) => {
    if (opts.tz)
        info.timestamp = (0, moment_timezone_1.default)().tz(opts.tz).format("YYYY-MM-DD HH:mm:ss");
    return info;
});
const { combine, timestamp, label, printf, errors } = winston_1.default.format;
const logDir = `${process_1.default.cwd()}/logs`;
const logFormat = printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${label}] ${level}: ${message}`; // 날짜 [시스템이름] 로그레벨 메세지
});
let logger = winston_1.default.createLogger({
    format: combine(appendTimestamp({ tz: "Asia/Seoul" }), label({ label: "Twitch Archive" }), // 어플리케이션 이름
    logFormat, // log 출력 포맷
    errors({ stack: true })
    //? format: combine() 에서 정의한 timestamp와 label 형식값이 logFormat에 들어가서 정의되게 된다. level이나 message는 콘솔에서 자동 정의
    ),
    transports: [
        //* info 레벨 로그를 저장할 파일 설정 (info: 2 보다 높은 error: 0 와 warn: 1 로그들도 자동 포함해서 저장)
        new winston_daily_rotate_file_1.default({
            level: "info",
            datePattern: "YYYY-MM-DD",
            dirname: logDir,
            filename: `%DATE%.log`,
            maxFiles: 30,
            zippedArchive: true, // 아카이브된 로그 파일을 gzip으로 압축할지 여부
        }),
        //* error 레벨 로그를 저장할 파일 설정 (info에 자동 포함되지만 일부러 따로 빼서 설정)
        new winston_daily_rotate_file_1.default({
            level: "error",
            datePattern: "YYYY-MM-DD",
            dirname: logDir + "/error",
            filename: `%DATE%.error.log`,
            maxFiles: 30,
            zippedArchive: true,
        }),
    ],
    exceptionHandlers: [
        new winston_daily_rotate_file_1.default({
            level: "error",
            datePattern: "YYYY-MM-DD",
            dirname: logDir,
            filename: `%DATE%.exception.log`,
            maxFiles: 30,
            zippedArchive: true,
        }),
    ],
});
if (process_1.default.env.NODE_ENV !== "production") {
    logger.add(new winston_1.default.transports.Console({
        format: winston_1.default.format.combine(winston_1.default.format.colorize(), // log level별로 색상 적용하기
        winston_1.default.format.simple() // `${info.level}: ${info.message} JSON.stringify({ ...rest })` 포맷으로 출력
        ),
    }));
}
exports.default = logger;
