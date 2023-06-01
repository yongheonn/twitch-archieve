import appRoot from "app-root-path"; // app root 경로를 가져오는 lib
import winston, { Logger } from "winston"; // winston lib
import winstonDaily from "winston-daily-rotate-file"; // winston lib
import process from "process";
import moment from "moment-timezone";

const appendTimestamp = winston.format((info, opts) => {
  if (opts.tz)
    info.timestamp = moment().tz(opts.tz).format("YYYY-MM-DD HH:mm:ss");
  return info;
});
const { combine, timestamp, label, printf, errors } = winston.format;

const logDir = `${process.cwd()}/logs`;

const logFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`; // 날짜 [시스템이름] 로그레벨 메세지
});

let logger: Logger = winston.createLogger({
  format: combine(
    appendTimestamp({ tz: "Asia/Seoul" }),
    label({ label: "Twitch Archive" }), // 어플리케이션 이름
    logFormat, // log 출력 포맷
    errors({ stack: true })
    //? format: combine() 에서 정의한 timestamp와 label 형식값이 logFormat에 들어가서 정의되게 된다. level이나 message는 콘솔에서 자동 정의
  ),
  transports: [
    //* info 레벨 로그를 저장할 파일 설정 (info: 2 보다 높은 error: 0 와 warn: 1 로그들도 자동 포함해서 저장)
    new winstonDaily({
      level: "info", // info 레벨에선
      datePattern: "YYYY-MM-DD", // 파일 날짜 형식
      dirname: logDir, // 파일 경로
      filename: `%DATE%.log`, // 파일 이름
      maxFiles: 30, // 최근 30일치 로그 파일을 남김
      zippedArchive: true, // 아카이브된 로그 파일을 gzip으로 압축할지 여부
    }),
    //* error 레벨 로그를 저장할 파일 설정 (info에 자동 포함되지만 일부러 따로 빼서 설정)
    new winstonDaily({
      level: "error", // error 레벨에선
      datePattern: "YYYY-MM-DD",
      dirname: logDir + "/error", // /logs/error 하위에 저장
      filename: `%DATE%.error.log`, // 에러 로그는 2020-05-28.error.log 형식으로 저장
      maxFiles: 30,
      zippedArchive: true,
    }),
  ],
  exceptionHandlers: [
    new winstonDaily({
      level: "error",
      datePattern: "YYYY-MM-DD",
      dirname: logDir,
      filename: `%DATE%.exception.log`,
      maxFiles: 30,
      zippedArchive: true,
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // log level별로 색상 적용하기
        winston.format.simple() // `${info.level}: ${info.message} JSON.stringify({ ...rest })` 포맷으로 출력
      ),
    })
  );
}
export default logger;
