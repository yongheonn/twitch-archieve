"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const request_1 = __importDefault(require("request"));
const winston_1 = __importDefault(require("./winston"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const googleapis_1 = require("googleapis");
const fluent_ffmpeg_1 = require("fluent-ffmpeg");
const config_1 = require("./config");
const youtube = googleapis_1.google.youtube("v3");
// Define our constants, you will change these with your own
const clientId = config_1.TWITCH_CLIENT_ID;
const secret = config_1.TWITCH_SECRET;
let access_token = "";
let stream_url_params = "";
let errorCount = 0;
let waitUploading = false;
let isProcessingQueue = false;
let info = {};
let quality = "1080p60";
let resetTime = new Date();
let exceptGames = config_1.ExceptGames;
let onlyChatStreamers = config_1.OnlyChat;
const refresh = 10; // 스트림을 확인하기 위해 간격(초)을 확인합니다. 소수점을 입력할 수 있습니다
const backupRefresh = 600;
const check_max = 20; // 녹음 품질을 확인할 횟수를 설정합니다. 검색횟수 이상의 녹화품질이 없을 경우 품질을 최상으로 변경하세요. 정수를 입력해야 합니다
const root_path = __dirname + "/"; // 녹화 경로 설정. thr 'r' 문자를 삭제하지 마십시오.
const streamlink_args = [
    "--stream-segment-threads",
    "5",
    "--stream-segment-attempts",
    "5",
    "--hls-live-edge",
    "6",
    "--hls-live-restart",
    "--twitch-disable-ads",
];
const InfoStatus = {
    DEFAULT: 0,
    READY: 1,
    RECORDING: 2,
    UPLOADING: 3,
    WAITING: 4,
    MERGING: 5,
    QUEUE: 6,
    TEMP: 7,
};
Object.freeze(InfoStatus);
// Initialize Express and middlewares
var app = (0, express_1.default)();
function sleep(seconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
    });
}
function doGetRequest(option) {
    return new Promise(function (resolve, reject) {
        request_1.default.get(option, function (error, res) {
            if (!error && res.statusCode === 200) {
                resolve(res);
            }
            else {
                reject(error);
            }
        });
    });
}
function doPostRequest(option) {
    return new Promise(function (resolve, reject) {
        request_1.default.post(option, function (error, res) {
            if (!error && res.statusCode === 200) {
                resolve(res);
            }
            else {
                reject(error);
            }
        });
    });
}
const getToken = () => __awaiter(void 0, void 0, void 0, function* () {
    const option = {
        url: "https://id.twitch.tv/oauth2/token?client_id=" +
            clientId +
            "&client_secret=" +
            secret +
            "&grant_type=client_credentials",
    };
    const response = yield doPostRequest(option);
    if (response && response.statusCode == 200) {
        access_token = JSON.parse(response.body)["access_token"];
        winston_1.default.info("success get access token: " + access_token);
    }
    else {
        winston_1.default.info("fail get access token");
        winston_1.default.info(response.errored);
    }
});
const revokeToken = () => __awaiter(void 0, void 0, void 0, function* () {
    const option = {
        url: "https://id.twitch.tv/oauth2/revoke?client_id=" +
            clientId +
            "&token=" +
            access_token,
    };
    winston_1.default.info("start access token revoke");
    const response = yield doPostRequest(option);
    if (response && response.statusCode == 200) {
        access_token = "";
        winston_1.default.info("success revoke access token: ");
    }
    else {
        winston_1.default.info("fail revoke access token");
        winston_1.default.info(response.errored);
    }
});
const createStreamParams = () => {
    let params = "";
    for (const streamerId in info) {
        params += "&user_login=" + streamerId;
    }
    const result = params.slice(1);
    winston_1.default.info("streamParams: " + result);
    return result;
};
const qualityParser = (m3u8) => {
    const quality = [];
    const m3u8_line_split = m3u8.split("\n");
    for (const m3u8_line of m3u8_line_split) {
        if (m3u8_line.indexOf("#EXT-X-MEDIA") !== -1 &&
            m3u8_line.indexOf("audio_only") == -1) {
            quality.push(m3u8_line
                .split(",")[2]
                .split("=")[1]
                .replace(/"/g, "")
                .replace(" (source)", ""));
        }
    }
    //quality.append(['best', 'worst'])
    return quality;
};
const getPat = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    const url_gql = "https://gql.twitch.tv/gql";
    const stream_token_query = {
        operationName: "PlaybackAccessToken",
        extensions: {
            persistedQuery: {
                version: 1,
                sha256Hash: "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712",
            },
        },
        variables: {
            isLive: true,
            login: id,
            isVod: false,
            vodID: "",
            playerType: "embed",
        },
    };
    const twitch_headers = {
        "Client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "user-agent": "Mozilla/5.0",
    };
    const option = {
        url: url_gql,
        body: JSON.stringify(stream_token_query),
        headers: twitch_headers,
    };
    try {
        const response = yield doPostRequest(option);
        if (response && response.statusCode == 200) {
            const access_token = JSON.parse(response.body)["data"]["streamPlaybackAccessToken"];
            try {
                const token_expire = Number(access_token["value"].split(",")[11].split(":")[1]);
                info[id][vidId]["pat"] = { token: access_token, expire: token_expire };
            }
            catch (e) {
                delete info[id][vidId]["pat"];
                winston_1.default.error("error", "PAT expiration time error, Change self.legacy_func to True", "ValueError: token_expire_time");
                //  self.legacy_func = True
                errorCount++;
            }
        }
        else {
            info[id][vidId]["patCheck"] += 1;
            return false;
        }
    }
    catch (e) {
        winston_1.default.error("error: " + e);
        errorCount++;
    }
});
const checkQuality = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        if (["best", "worst"].includes(info[id][vidId].quality))
            return true;
        const twitch_headers = {
            "Client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
            "user-agent": "Mozilla/5.0",
        };
        const url_usher = "https://usher.ttvnw.net/api/channel/hls/" + id + ".m3u8";
        // get playback access token and get m3u8
        if (info[id][vidId]["pat"] !== undefined) {
            if (new Date().getTime() / 1000 >= ((_a = info[id][vidId].pat) === null || _a === void 0 ? void 0 : _a.expire))
                winston_1.default.info("info", "", "Get new PAT for " + id + "_" + vidId + ".");
            delete info[id][vidId]["pat"];
        }
        else {
            yield getPat(id, vidId);
        }
        const params_usher = {
            client_id: "kimne78kx3ncx6brgo4mv6wki5h1ko",
            token: (_b = info[id][vidId].pat) === null || _b === void 0 ? void 0 : _b.token.value,
            sig: (_c = info[id][vidId].pat) === null || _c === void 0 ? void 0 : _c.token.signature,
            allow_source: true,
            allow_audio_only: true,
        };
        const option = {
            url: url_usher,
            qs: params_usher,
            headers: twitch_headers,
        };
        const response = yield doGetRequest(option);
        if (response && response.statusCode == 200) {
            const live_quality = qualityParser(response.body);
            winston_1.default.info("Available ttvnw quality of " + id + " : " + live_quality);
            if (!live_quality) {
                info[id][vidId].patCheck += 1;
                return false;
            }
            else if (quality === "best") {
                info[id][vidId].quality = live_quality[0];
                return true;
            }
            else if (quality === "worst") {
                info[id][vidId].quality = live_quality.at(-1);
                return true;
            }
            // desired stream quality is available
            else if (live_quality.includes(quality)) {
                info[id][vidId].quality = quality;
                info[id][vidId].patCheck = 0;
                return true;
            }
            // if the desired stream quality is not available
            else {
                info[id][vidId].patCheck += 1;
                winston_1.default.info(id +
                    " stream is online. but " +
                    quality +
                    " quality could not be found. Check: " +
                    info[id][vidId].patCheck);
                //       if (info[id][vidId].patCheck >= check_max) {
                info[id][vidId].quality = live_quality[0];
                winston_1.default.info("Change " + id + " stream quality to best.");
                info[id][vidId].patCheck = 0;
                return true;
                //      }
            }
        }
    }
    catch (e) {
        winston_1.default.error("quality error: " + e);
        errorCount++;
        return false;
    }
    return false;
});
const checkLive = () => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e;
    try {
        const option = {
            url: "https://api.twitch.tv/helix/streams?" + stream_url_params,
            headers: {
                Authorization: "Bearer " + access_token,
                "Client-Id": clientId,
            },
        };
        const response = yield doGetRequest(option);
        if (response && response.statusCode == 200) {
            const streamList = JSON.parse(response.body)["data"];
            for (const stream of streamList) {
                const isNew = !(stream["id"] in info[stream["user_login"]]);
                let isValid = false;
                const isOnlyChatStreamer = onlyChatStreamers.includes(stream["user_login"]);
                if (isOnlyChatStreamer) {
                    const isNotChat = stream["game_name"] !== "Just Chatting";
                    if (isNew) {
                        info[stream["user_login"]][stream["id"]] = {
                            title: stream["title"],
                            game: [stream["game_name"]],
                            changeTime: [new Date().getTime() / 1000],
                            queueTime: undefined,
                            quality: quality,
                            status: InfoStatus.DEFAULT,
                            fileName: [],
                            pat: undefined,
                            patCheck: 0,
                            procs: undefined,
                            num: 0,
                            queueNum: 0,
                        };
                        if (!isNotChat) {
                            isValid = yield checkQuality(stream["user_login"], stream["id"]);
                            winston_1.default.info(stream["user_login"] +
                                "_" +
                                stream["id"] +
                                " quality check done");
                            info[stream["user_login"]][stream["id"]].fileName.push(stream["id"]);
                        }
                    }
                    const isRecording = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.RECORDING;
                    const isWaiting = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.WAITING;
                    const isDefault = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.DEFAULT;
                    const isNewGame = info[stream["user_login"]][stream["id"]].game.at(-1) !==
                        stream["game_name"];
                    if (isValid)
                        info[stream["user_login"]][stream["id"]]["status"] =
                            InfoStatus.READY;
                    if (isNotChat && isRecording) {
                        info[stream["user_login"]][stream["id"]]["status"] =
                            InfoStatus.WAITING;
                        (_d = info[stream["user_login"]][stream["id"]]["procs"]) === null || _d === void 0 ? void 0 : _d.kill(2);
                        delete info[stream["user_login"]][stream["id"]]["procs"];
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        continue;
                    }
                    if (!isNotChat && isRecording && isNewGame) {
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        continue;
                    }
                    if (!isNotChat &&
                        (isWaiting ||
                            (isDefault &&
                                exceptGames.includes(info[stream["user_login"]][stream["id"]].game[0])))) {
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        info[stream["user_login"]][stream["id"]].status = InfoStatus.READY;
                        info[stream["user_login"]][stream["id"]].fileName.push(info[stream["user_login"]][stream["id"]].fileName[0] +
                            "_" +
                            info[stream["user_login"]][stream["id"]].fileName.length);
                        continue;
                    }
                    winston_1.default.info(stream["user_login"] + " is online");
                }
                else {
                    const isExceptGame = exceptGames.includes(stream["game_name"]);
                    if (isNew) {
                        info[stream["user_login"]][stream["id"]] = {
                            title: stream["title"],
                            game: [stream["game_name"]],
                            changeTime: [new Date().getTime() / 1000],
                            queueTime: undefined,
                            quality: quality,
                            status: InfoStatus.DEFAULT,
                            fileName: [],
                            pat: undefined,
                            patCheck: 0,
                            procs: undefined,
                            num: 0,
                            queueNum: 0,
                        };
                        if (!isExceptGame) {
                            isValid = yield checkQuality(stream["user_login"], stream["id"]);
                            winston_1.default.info(stream["user_login"] +
                                "_" +
                                stream["id"] +
                                " quality check done");
                            info[stream["user_login"]][stream["id"]].fileName.push(stream["id"]);
                        }
                    }
                    const isRecording = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.RECORDING;
                    const isWaiting = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.WAITING;
                    const isDefault = info[stream["user_login"]][stream["id"]]["status"] ===
                        InfoStatus.DEFAULT;
                    const isNewGame = info[stream["user_login"]][stream["id"]].game.at(-1) !==
                        stream["game_name"];
                    if (isValid)
                        info[stream["user_login"]][stream["id"]]["status"] =
                            InfoStatus.READY;
                    if (isExceptGame && isRecording) {
                        info[stream["user_login"]][stream["id"]]["status"] =
                            InfoStatus.WAITING;
                        (_e = info[stream["user_login"]][stream["id"]]["procs"]) === null || _e === void 0 ? void 0 : _e.kill(2);
                        delete info[stream["user_login"]][stream["id"]]["procs"];
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        continue;
                    }
                    if (!isExceptGame && isRecording && isNewGame) {
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        continue;
                    }
                    if (!isExceptGame &&
                        (isWaiting ||
                            (isDefault &&
                                exceptGames.includes(info[stream["user_login"]][stream["id"]].game[0])))) {
                        info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                        info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                        info[stream["user_login"]][stream["id"]].status = InfoStatus.READY;
                        info[stream["user_login"]][stream["id"]].fileName.push(info[stream["user_login"]][stream["id"]].fileName[0] +
                            "_" +
                            info[stream["user_login"]][stream["id"]].fileName.length);
                        continue;
                    }
                    winston_1.default.info(stream["user_login"] + " is online");
                }
            }
            winston_1.default.info("start check stream status");
            const vidIdList = [];
            for (const stream of streamList)
                vidIdList.push(stream.id);
            for (const streamerId in info) {
                for (const vidId in info[streamerId]) {
                    const isWaiting = info[streamerId][vidId]["status"] === InfoStatus.WAITING;
                    const isDefault = info[streamerId][vidId]["status"] === InfoStatus.DEFAULT;
                    const isReady = info[streamerId][vidId]["status"] === InfoStatus.READY;
                    if (!vidIdList.includes(vidId)) {
                        if (isWaiting) {
                            info[streamerId][vidId] = Object.assign(Object.assign({}, info[streamerId][vidId]), { status: InfoStatus.MERGING });
                            yield mergeVideo(streamerId, vidId);
                        }
                        else if (isDefault || isReady) {
                            delete info[streamerId][vidId];
                        }
                    }
                }
            }
        }
        else if (response.statusCode === 401) {
            yield getToken();
            const res_message = JSON.parse(response.body)["message"];
            winston_1.default.info("error 401: " + res_message + ". regenerate token...");
        }
        else if (response.statusCode === 400) {
            const res_message = JSON.parse(response.body)["message"];
            winston_1.default.info("error 400: " + res_message);
        }
        else if (response.statusCode === 429) {
            winston_1.default.info("Too many request! wait until reset-time...");
            const reset_time = Number(response.headers["Ratelimit-Reset"]);
            while (true) {
                const now_timestamp = new Date().getTime() / 1000;
                if (reset_time < now_timestamp) {
                    winston_1.default.info("Reset-time! continue to check...", "Reset-time! continue to check...");
                    break;
                }
                else {
                    winston_1.default.info("Check streamlink process... " +
                        "reset-time: " +
                        reset_time +
                        ", now: " +
                        now_timestamp);
                }
            }
        }
        else {
            winston_1.default.info("server error(live)! status_code: " +
                response.statusCode +
                "\n message: " +
                response.body);
        }
    }
    catch (e) {
        winston_1.default.error(" requests.exceptions.ConnectionError. Go back checking...  message: " + e);
        errorCount++;
    }
});
const doProcess = () => __awaiter(void 0, void 0, void 0, function* () {
    while (true) {
        yield checkLive();
        yield sleep(refresh);
        if (info) {
            for (const id in info) {
                for (const vidId in info[id]) {
                    if (info[id][vidId]["status"] === InfoStatus.READY) {
                        recordStream(id, vidId);
                    }
                    //print('Now Online:', list(self.procs.keys()))
                }
            }
        }
        winston_1.default.info("isProcessingQueue: " + isProcessingQueue);
        if (!isProcessingQueue) {
            processYoutubeQueue()
                .then(() => null)
                .catch(() => null);
        }
        yield sleep(refresh);
    }
});
const processYoutubeQueue = () => __awaiter(void 0, void 0, void 0, function* () {
    isProcessingQueue = true;
    const now = new Date();
    try {
        if (now.getTime() > resetTime.getTime()) {
            let sortObj = [];
            for (const id in info) {
                for (const vidId in info[id]) {
                    if (info[id][vidId].status === InfoStatus.QUEUE) {
                        sortObj.push([info[id][vidId].queueTime, id, vidId]);
                    }
                }
            }
            sortObj.sort(function (a, b) {
                return b[0] - a[0];
            });
            if (sortObj.length > 0) {
                winston_1.default.info("uploading sort start: " + sortObj);
                for (const queue of sortObj) {
                    if (info[queue[1]][queue[2]].num === 1) {
                        youtubeUpload(queue[1], queue[2], -1);
                        while (waitUploading) {
                            winston_1.default.info("waiting uploading " + queue[1] + "_" + queue[2] + " completed");
                            yield sleep(5);
                        }
                        if (new Date().getTime() < resetTime.getTime()) {
                            isProcessingQueue = false;
                            return;
                        }
                    }
                    else {
                        const startIndex = info[queue[1]][queue[2]].queueNum;
                        for (let i = startIndex; i < info[queue[1]][queue[2]].num; i++) {
                            youtubeUpload(queue[1], queue[2], i);
                            while (waitUploading) {
                                winston_1.default.info("waiting uploading " +
                                    queue[1] +
                                    "_" +
                                    queue[2] +
                                    "_" +
                                    i +
                                    " completed");
                                yield sleep(5);
                            }
                            if (new Date().getTime() < resetTime.getTime()) {
                                isProcessingQueue = false;
                                return;
                            }
                        }
                    }
                    winston_1.default.info("processing next queue");
                }
            }
        }
        winston_1.default.info("end processing queue");
        isProcessingQueue = false;
    }
    catch (e) {
        winston_1.default.error(e);
        isProcessingQueue = false;
    }
});
const recordStream = (id, vidId) => {
    var _a, _b, _c;
    winston_1.default.info(id + " is online. Stream recording in session.");
    const downloadPath = root_path + id + "/";
    if (!fs_1.default.existsSync(downloadPath))
        fs_1.default.mkdirSync(downloadPath);
    const filePath = downloadPath + info[id][vidId].fileName.at(-1) + ".ts";
    info[id][vidId]["procs"] = (0, child_process_1.spawn)("streamlink", [
        ...streamlink_args,
        ...["www.twitch.tv/" + id, info[id][vidId]["quality"], "-o", filePath],
    ]); //return code: 3221225786, 130
    info[id][vidId] = Object.assign(Object.assign({}, info[id][vidId]), { status: InfoStatus.RECORDING });
    (_b = (_a = info[id][vidId]["procs"]) === null || _a === void 0 ? void 0 : _a.stdout) === null || _b === void 0 ? void 0 : _b.on("data", (data) => {
        winston_1.default.info(data);
    });
    /*
  info: error: Error when reading from stream: Read timeout, exiting
  위의 에러 발생시 프로세스 다시 시작하기 만들기
  */
    (_c = info[id][vidId]["procs"]) === null || _c === void 0 ? void 0 : _c.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
        winston_1.default.info(id + " stream is done. status: " + code);
        if (code == 0 || code == 1) {
            delete info[id][vidId]["procs"];
            delete info[id][vidId].procs;
            info[id][vidId] = Object.assign(Object.assign({}, info[id][vidId]), { status: InfoStatus.MERGING });
            yield mergeVideo(id, vidId);
        }
    }));
    winston_1.default.info(id + " stream recording in session.");
};
const checkVideoLength = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    let waitForCrop = true;
    let returnValue = 1;
    (0, fluent_ffmpeg_1.ffprobe)(root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts", function (err, metadata) {
        return __awaiter(this, void 0, void 0, function* () {
            const duration = metadata.format.duration;
            if (duration) {
                const hour = Math.floor(duration / 3600);
                const minute = Math.floor((duration % 3600) / 60);
                const second = Math.floor((duration % 3600) % 60);
                const quotient = Math.floor((hour * 3600 + minute * 60 + second) / (11 * 3600));
                if (quotient >= 1) {
                    winston_1.default.info(id +
                        "_" +
                        vidId +
                        " duration: " +
                        hour +
                        ":" +
                        minute +
                        ":" +
                        second);
                    yield cropVideo(id, vidId, quotient, hour + ":" + minute + ":" + second);
                    returnValue = quotient + 1;
                }
            }
            waitForCrop = false;
        });
    });
    while (waitForCrop) {
        yield sleep(5);
    }
    return returnValue;
});
const cropVideo = (id, vidId, quotient, duration) => __awaiter(void 0, void 0, void 0, function* () {
    let waitForCrop = true;
    for (let i = 0; i < quotient; i++) {
        const cropProcess = (0, child_process_1.spawn)("ffmpeg", [
            "-i",
            root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts",
            "-ss",
            (i * 11).toString() + ":00:00",
            "-to",
            ((i + 1) * 11).toString() + ":00:00",
            "-vcodec",
            "copy",
            "-acodec",
            "copy",
            root_path +
                id +
                "/" +
                info[id][vidId].fileName[0] +
                "_final_" +
                i.toString() +
                ".ts",
        ]);
        cropProcess.stderr.on("data", (data) => {
            winston_1.default.info("cut process: " + data);
        });
        cropProcess.on("exit", (result) => {
            waitForCrop = false;
        });
        while (waitForCrop) {
            yield sleep(5);
        }
        waitForCrop = true;
    }
    const cropProcess = (0, child_process_1.spawn)("ffmpeg", [
        "-i",
        root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts",
        "-ss",
        (quotient * 11).toString() + ":00:00",
        "-to",
        duration,
        "-vcodec",
        "copy",
        "-acodec",
        "copy",
        root_path +
            id +
            "/" +
            info[id][vidId].fileName[0] +
            "_final_" +
            quotient.toString() +
            ".ts",
    ]);
    cropProcess.stderr.on("data", (data) => {
        winston_1.default.info("cut process: " + data);
    });
    cropProcess.on("exit", (result) => {
        fs_1.default.unlink(root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts", (err) => {
            if (err)
                throw err;
            winston_1.default.info(root_path +
                id +
                "/" +
                info[id][vidId].fileName[0] +
                "_final.ts" +
                " is deleted.");
            waitForCrop = false;
        });
    });
    while (waitForCrop) {
        yield sleep(5);
    }
});
const mergeVideo = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        winston_1.default.info(id + "_" + vidId + " merge start");
        if (info[id][vidId].fileName.length === 1) {
            fs_1.default.renameSync(root_path + id + "/" + info[id][vidId].fileName[0] + ".ts", root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts");
            const length = yield checkVideoLength(id, vidId);
            winston_1.default.info(id + "_" + vidId + " rename done");
            enqueue(id, vidId, length);
        }
        else if (info[id][vidId].fileName.length > 1) {
            const inputFile = root_path + id + "/" + info[id][vidId].fileName[0] + ".txt";
            let data = "";
            for (const fileName of info[id][vidId].fileName) {
                data += "file " + fileName + ".ts" + "\n";
            }
            fs_1.default.writeFileSync(inputFile, data, "utf8");
            const concatProcess = (0, child_process_1.spawn)("ffmpeg", [
                "-safe",
                "0",
                "-f",
                "concat",
                "-i",
                inputFile,
                "-c",
                "copy",
                root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts",
            ]); //return code: 3221225786, 130;
            concatProcess.stderr.on("data", (data) => __awaiter(void 0, void 0, void 0, function* () {
                winston_1.default.info("ffmpeg: " + data);
            }));
            concatProcess.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
                winston_1.default.info(id + " merge is done. status: " + code);
                for (const fileName of info[id][vidId].fileName) {
                    fs_1.default.unlink(root_path + id + "/" + fileName + ".ts", (err) => {
                        if (err) {
                            winston_1.default.error(id + "_" + fileName + " ts delete error");
                            throw err;
                        }
                        winston_1.default.info(fileName + " is deleted.");
                    });
                }
                fs_1.default.unlink(root_path + id + "/" + info[id][vidId].fileName[0] + ".txt", (err) => {
                    if (err) {
                        winston_1.default.error(id + "_" + info[id][vidId].fileName[0] + ".txt delete error");
                        throw err;
                    }
                    winston_1.default.info(root_path +
                        id +
                        "/" +
                        info[id][vidId].fileName[0] +
                        ".txt" +
                        " is deleted.");
                });
                const length = yield checkVideoLength(id, vidId);
                enqueue(id, vidId, length);
            }));
        }
    }
    catch (e) {
        winston_1.default.error(e);
        errorCount++;
    }
});
const youtubeUpload = (id, vidId, num) => {
    waitUploading = true;
    const recordAt = new Date(info[id][vidId]["changeTime"][0] * 1000);
    const utc = recordAt.getTime() + recordAt.getTimezoneOffset() * 60 * 1000;
    winston_1.default.info(id + "_" + vidId + " youtube upload start");
    // 3. UTC to KST (UTC + 9시간)
    const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
    const kr_curr = new Date(utc + KR_TIME_DIFF);
    let title = id +
        " " +
        kr_curr.toLocaleString() +
        " " +
        info[id][vidId]["title"] +
        (num === -1 ? "" : "_" + num);
    title = title.replace(/[<>()]/gim, "");
    const exceptGameIndex = [];
    let fromIndex = 0;
    for (const exceptGame of exceptGames) {
        while (true) {
            fromIndex = info[id][vidId].game.indexOf(exceptGame, fromIndex);
            exceptGameIndex.push(fromIndex);
            if (fromIndex === -1)
                break;
            fromIndex++;
        }
    }
    let description = "";
    let startAt = num === -1 ? 0 : 11 * num * 3600;
    let endAt = num === -1 ? 0 : 11 * num * 3600;
    let checkTime = 0;
    for (let i = 0; i < info[id][vidId]["game"].length - 1; i++) {
        startAt = endAt;
        let isExceptTime = false;
        for (const index of exceptGameIndex) {
            if (i === index) {
                isExceptTime = true;
            }
        }
        if (!isExceptTime) {
            checkTime +=
                info[id][vidId]["changeTime"][i + 1] - info[id][vidId]["changeTime"][i];
            if (checkTime < startAt) {
                continue;
            }
            endAt +=
                info[id][vidId]["changeTime"][i + 1] - info[id][vidId]["changeTime"][i];
        }
        if (checkTime < startAt) {
            continue;
        }
        const startHour = Math.floor(startAt / 3600) - (num === -1 ? 0 : 11 * num * 3600);
        const startMinute = Math.floor((startAt % 3600) / 60);
        const startSeconds = Math.floor((startAt % 3600) % 60);
        const endHour = Math.floor(endAt / 3600) - (num === -1 ? 0 : 11 * num * 3600);
        const endMinute = Math.floor((endAt % 3600) / 60);
        const endSeconds = Math.floor((endAt % 3600) % 60);
        description +=
            String(startHour).padStart(2, "0") +
                ":" +
                String(startMinute).padStart(2, "0") +
                ":" +
                String(startSeconds).padStart(2, "0") +
                " ~ " +
                String(endHour).padStart(2, "0") +
                ":" +
                String(endMinute).padStart(2, "0") +
                ":" +
                String(endSeconds).padStart(2, "0") +
                " " +
                info[id][vidId]["game"][i] +
                "\n";
    }
    const hour = Math.floor(endAt / 3600);
    const minute = Math.floor((endAt % 3600) / 60);
    const seconds = Math.floor((endAt % 3600) % 60);
    description +=
        String(hour).padStart(2, "0") +
            ":" +
            String(minute).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0") +
            " ~ final " +
            info[id][vidId].game.at(-1);
    winston_1.default.info(id + "_" + vidId + " readStream start");
    const media = fs_1.default.createReadStream(root_path +
        id +
        "/" +
        info[id][vidId].fileName[0] +
        "_final" +
        (num === -1 ? "" : "_" + num) +
        ".ts");
    winston_1.default.info(root_path +
        id +
        "/" +
        info[id][vidId].fileName[0] +
        "_final" +
        (num === -1 ? "" : "_" + num) +
        ".ts");
    const oauth2Client = config_1.Oauth2Client;
    const config = {
        auth: oauth2Client,
        part: ["snippet", "status"],
        resource: {
            snippet: {
                title: title,
                description: description,
                tags: [id],
            },
            status: {
                privacyStatus: "private", // public, unlisted, private
            },
        },
        media: {
            body: media, // media
        },
    };
    winston_1.default.info("upload start ");
    info[id][vidId].status = InfoStatus.UPLOADING;
    youtube.videos.insert(config, (err, data) => {
        if (err) {
            winston_1.default.error("err: uploading error: " + err);
            info[id][vidId].status = InfoStatus.QUEUE;
            const now = new Date();
            if (now.getHours() >= 7) {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 10);
            }
            else {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 10);
            }
            waitUploading = false;
        }
        else {
            info[id][vidId].queueNum++;
            winston_1.default.info("response: " + JSON.stringify(data));
            fs_1.default.unlink(root_path +
                id +
                "/" +
                info[id][vidId].fileName[0] +
                "_final" +
                (num === -1 ? "" : "_" + num) +
                ".ts", (err) => {
                if (err)
                    throw err;
                winston_1.default.info(root_path +
                    id +
                    "/" +
                    info[id][vidId].fileName[0] +
                    "_final" +
                    (num === -1 ? "" : "_" + num) +
                    ".ts" +
                    " is deleted.");
                if (info[id][vidId].num - 1 === num || num === -1)
                    delete info[id][vidId];
            });
            waitUploading = false;
        }
    });
    winston_1.default.info("uploading ");
};
const enqueue = (id, vidId, length) => {
    info[id][vidId].status = InfoStatus.QUEUE;
    info[id][vidId].queueTime = new Date().getTime();
    info[id][vidId].num = length;
    winston_1.default.info(id + "_" + vidId + " enqueue");
};
process.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
    var _f;
    winston_1.default.info(`exit code : ${code}`);
    for (const id in info) {
        for (const vidId in info[id]) {
            if (info[id][vidId].status === InfoStatus.RECORDING) {
                info[id][vidId].status = InfoStatus.WAITING;
                (_f = info[id][vidId].procs) === null || _f === void 0 ? void 0 : _f.kill(2);
                delete info[id][vidId].procs;
                info[id][vidId]["game"].push("서버 프로그램 종료");
                info[id][vidId]["changeTime"].push(new Date().getTime() / 1000);
            }
            else if (info[id][vidId].status === InfoStatus.UPLOADING) {
                while (vidId in info[id]) {
                    yield sleep(2); //업로딩이 완료될 때까지 대기(delete info[id][vidId] 대기)
                }
            }
        }
    }
    fs_1.default.writeFileSync(root_path + "info.json", JSON.stringify(info));
    fs_1.default.writeFileSync(root_path + "reset_time.dat", resetTime.getTime().toString());
    fs_1.default.writeFileSync(root_path + "check_exit_valid.dat", "valid");
    winston_1.default.info(`info.json : ${info}`);
    revokeToken();
    winston_1.default.info(`exit process complete`);
    if (code !== 0) {
        winston_1.default.info({
            exitCode: code,
            message: "I'm gone",
            timestamp: new Date(),
        });
    }
}));
process.once("SIGINT", () => __awaiter(void 0, void 0, void 0, function* () {
    var _g;
    winston_1.default.info("You've pressed Ctrl + C on this process.");
    for (const id in info) {
        for (const vidId in info[id]) {
            if (info[id][vidId].status === InfoStatus.RECORDING) {
                info[id][vidId].status = InfoStatus.WAITING;
                (_g = info[id][vidId].procs) === null || _g === void 0 ? void 0 : _g.kill(2);
                delete info[id][vidId].procs;
                info[id][vidId]["game"].push("서버 프로그램 종료");
                info[id][vidId]["changeTime"].push(new Date().getTime() / 1000);
            }
            else if (info[id][vidId].status === InfoStatus.UPLOADING) {
                while (vidId in info[id]) {
                    yield sleep(refresh / 5); //업로딩이 완료될 때까지 대기(delete info[id][vidId] 대기)
                }
            }
        }
    }
    fs_1.default.writeFileSync(root_path + "info.json", JSON.stringify(info));
    fs_1.default.writeFileSync(root_path + "reset_time.dat", resetTime.getTime().toString());
    fs_1.default.writeFileSync(root_path + "check_exit_valid.dat", "valid");
    winston_1.default.info(`info.json : ${info}`);
    revokeToken();
    winston_1.default.info(`exit process complete`);
}));
app.set("view engine", "ejs");
app.set("index", "./views/index");
app.get("/", function (req, res) {
    res.render("index", {
        info,
        InfoStatus,
        statusMessage: [
            "온라인",
            "준비 중",
            "녹화 중",
            "업로딩 중",
            "대기 중",
            "동영상 처리 중",
            "유튜브 업로딩 대기 중",
            "임시 상태",
        ],
        errorCount: errorCount,
        resetTime: resetTime,
        exceptGames: exceptGames,
        onlyChatStreamers: onlyChatStreamers,
    });
});
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
app.post("/add_streamer", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("add_streamer req body: " + JSON.stringify(data));
        let added = data["addedStreamer"];
        if (added in info) {
            winston_1.default.info("existed streamer: " + added);
            res.status(400).send();
        }
        else {
            info[added] = {};
            stream_url_params = createStreamParams();
            winston_1.default.info("added streamer: " + added);
            res.status(200).send();
        }
    }
    catch (e) {
        winston_1.default.error("error add streamer: " + e);
        res.status(400).send();
    }
});
app.post("/reset_yesterday", function (req, res) {
    try {
        resetTime = new Date(resetTime.getFullYear(), resetTime.getMonth(), resetTime.getDate() - 1, 7, 10);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error reset yesterday: " + e);
        res.status(400).send();
    }
});
app.post("/reset_tommorow", function (req, res) {
    try {
        resetTime = new Date(resetTime.getFullYear(), resetTime.getMonth(), resetTime.getDate() + 1, 7, 10);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error reset tommorow: " + e);
        res.status(400).send();
    }
});
app.post("/check_only_chat", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("check_only_chat req body: " + JSON.stringify(data));
        if (onlyChatStreamers.includes(data["streamer"]))
            onlyChatStreamers = onlyChatStreamers.filter((streamer) => streamer !== data["streamer"]);
        else
            onlyChatStreamers.push(data["streamer"]);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error add streamer: " + e);
        res.status(400).send();
    }
});
const checkStreamerStatus = (streamer) => {
    var _a;
    for (const vidId in info[streamer]) {
        const status = info[streamer][vidId].status;
        if (status === InfoStatus.RECORDING) {
            (_a = info[streamer][vidId].procs) === null || _a === void 0 ? void 0 : _a.kill(2);
            for (const fileName of info[streamer][vidId].fileName)
                fs_1.default.unlink(root_path + streamer + "/" + fileName + ".ts", (err) => {
                    if (err) {
                        winston_1.default.error(streamer + "_" + fileName + " ts delete error");
                        throw err;
                    }
                    winston_1.default.info(fileName + " is deleted.");
                });
        }
        else if (status === InfoStatus.QUEUE) {
            if (info[streamer][vidId].num === 1) {
                fs_1.default.unlink(root_path + streamer + "/" + vidId + "_final.ts", (err) => {
                    if (err) {
                        winston_1.default.error(streamer + "_" + vidId + " ts delete error");
                        throw err;
                    }
                    winston_1.default.info(vidId + " is deleted.");
                });
            }
            else {
                for (let i = 0; i < info[streamer][vidId].num; i++) {
                    fs_1.default.unlink(root_path +
                        streamer +
                        "/" +
                        vidId +
                        "_final_" +
                        i.toString() +
                        ".ts", (err) => {
                        if (err) {
                            winston_1.default.error(streamer +
                                "/" +
                                vidId +
                                "_final_" +
                                i.toString() +
                                " ts delete error");
                            throw err;
                        }
                        winston_1.default.info(vidId + "_final_" + i.toString() + " is deleted.");
                    });
                }
            }
        }
        else if (status === InfoStatus.WAITING || status === InfoStatus.MERGING) {
            for (const fileName of info[streamer][vidId].fileName)
                fs_1.default.unlink(root_path + streamer + "/" + fileName + ".ts", (err) => {
                    if (err) {
                        winston_1.default.error(streamer + "_" + fileName + " ts delete error");
                        throw err;
                    }
                    winston_1.default.info(fileName + " is deleted.");
                });
        }
        else if (status === InfoStatus.UPLOADING) {
            return false;
        }
    }
    return true;
};
app.post("/delete_streamer", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("delete_streamer req body: " + JSON.stringify(data));
        const deleted = data["streamer"];
        const isValid = checkStreamerStatus(deleted);
        if (isValid) {
            delete info[deleted];
            stream_url_params = createStreamParams();
            winston_1.default.info("deleted streamer: " + deleted);
        }
        res.status(200).send({ isValid: isValid });
    }
    catch (e) {
        winston_1.default.error("error delete streamer: " + e);
        res.status(400).send();
    }
});
app.post("/except_games", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("except_games req body: " + JSON.stringify(data));
        exceptGames = data["exceptGames"].split(",");
        winston_1.default.info("update exceptGames: " + exceptGames);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error update exceptGames: " + e);
        res.status(400).send();
    }
});
app.post("/except_", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("except_games req body: " + JSON.stringify(data));
        exceptGames = data["exceptGames"].split(",");
        winston_1.default.info("update exceptGames: " + exceptGames);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error update exceptGames: " + e);
        res.status(400).send();
    }
});
app.post("/upload_streamer", function (req, res) {
    try {
        const data = req.body;
        winston_1.default.info("upload_streamer req body: " + JSON.stringify(data));
        const streamer = data["uploadStreamer"];
        const uploadId = data["uploadId"];
        if (!(streamer in info)) {
            info[streamer] = {};
        }
        fs_1.default.readdir(root_path + streamer, function (error, filelist) {
            return __awaiter(this, void 0, void 0, function* () {
                let finalFile = false; // _final 여부
                let isFile = false; // 파일 자체 여부
                let finalCount = 0; // _final_ 파일 개수
                let count = 0; // final이 없는 처리 전 파일 개수
                /*
                  _final이 있는데, _final_도 존재하면, 파일 처리 과정에서 용량 제한을 넘어서 에러가 생긴 케이스
                  그러므로, 따로 처리해줘야함
                  */
                for (const file of filelist) {
                    if (file.search(uploadId) >= 0) {
                        isFile = true;
                        if (file.search("final_") >= 0) {
                            finalCount++;
                        }
                        else if (file.search("_final") >= 0) {
                            finalFile = true;
                        }
                        else if (file.search(uploadId + "_") >= 0) {
                            count++;
                        }
                    }
                }
                if (finalFile && finalCount === 0) {
                    info[streamer][uploadId] = {
                        title: uploadId,
                        game: ["Unknown"],
                        changeTime: [new Date().getTime() / 1000],
                        queueTime: undefined,
                        quality: "1080p60",
                        status: InfoStatus.QUEUE,
                        fileName: [uploadId],
                        pat: undefined,
                        patCheck: 0,
                        procs: undefined,
                        num: 1,
                        queueNum: 0,
                    };
                }
                else if (finalCount > 0 && finalFile) {
                    /*
                    if ( fs.existsSync(root_path + streamer + "/" + uploadId + "_final.ts") ) {
            
                      var aStats = fs.statSync(root_path + streamer + "/" + uploadId + "_final.ts")
                  
                      const fileSize  = aStats.size / (1024 * 1024 * 1024);
                  
                     const freeSize = 140 - fileSize;
            
                     if(fileSize / freeSize < 3) {
            
                     }
                  
                  }
                  */
                    // 나중에 구현, 여유공간만큼 비디오를 자르면서 전부 자른 후 업로딩이 아닌, 자른 분량을 업로딩한 후에 하나씩 잘라가면서 업로딩
                }
                else if (finalCount > 0 && !finalFile) {
                    info[streamer][uploadId] = {
                        title: uploadId,
                        game: ["Unknown"],
                        changeTime: [new Date().getTime() / 1000],
                        queueTime: undefined,
                        quality: "1080p60",
                        status: InfoStatus.QUEUE,
                        fileName: [uploadId],
                        pat: undefined,
                        patCheck: 0,
                        procs: undefined,
                        num: finalCount,
                        queueNum: 0,
                    };
                }
                else if (isFile) {
                    info[streamer][uploadId] = {
                        title: uploadId,
                        game: ["Unknown"],
                        changeTime: [new Date().getTime() / 1000],
                        queueTime: undefined,
                        quality: "1080p60",
                        status: InfoStatus.MERGING,
                        fileName: [uploadId],
                        pat: undefined,
                        patCheck: 0,
                        procs: undefined,
                        num: 0,
                        queueNum: 0,
                    };
                    for (let i = 1; i < count; i++) {
                        info[streamer][uploadId].fileName.push(uploadId + "_" + i.toString());
                    }
                    yield mergeVideo(streamer, uploadId);
                }
            });
        });
        winston_1.default.info("upload_streamer: " + streamer + "_" + uploadId);
        res.status(200).send();
    }
    catch (e) {
        winston_1.default.error("error upload_streamer: " + e);
        res.status(400).send();
    }
});
/*
app.get("/redirect", function (req, res) {
  let { code, state } = req.query;
  const oauth2Client = new google.auth.OAuth2(
    "1024921311743-c0facphte80lu6btgqun3u7tv2lh0aib.apps.googleusercontent.com",
    "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",
    "http://localhost:3000/redirect"
  );
  oauth2Client.getToken(code as string, function (err, token) {
    if (err) {
      console.log("Error while trying to retrieve access token", err);
      return;
    }
    console.log("token: " + JSON.stringify(token));
  });
});
*/
const checkExitValid = () => {
    if (fs_1.default.existsSync(root_path + "check_exit_valid.dat")) {
        const data = fs_1.default.readFileSync("check_exit_valid.dat", "utf8");
        if (data.toString() !== "valid") {
            for (const id in info) {
                for (const vidId in info[id]) {
                    if (info[id][vidId].status === InfoStatus.RECORDING) {
                        info[id][vidId].status = InfoStatus.WAITING;
                        delete info[id][vidId].procs;
                        info[id][vidId]["game"].push("서버 프로그램 종료");
                        info[id][vidId]["changeTime"].push(new Date().getTime() / 1000);
                    }
                }
            }
            fs_1.default.writeFileSync(root_path + "check_exit_valid.dat", "invalid");
        }
    }
};
const checkVideoList = () => {
    if (fs_1.default.existsSync(root_path + "info.json")) {
        info = require(root_path + "info.json");
        winston_1.default.info("success to load info: " + JSON.stringify(info));
    }
};
const setDefaultResetTime = () => {
    if (fs_1.default.existsSync(root_path + "reset_time.dat")) {
        const data = fs_1.default.readFileSync("reset_time.dat", "utf8");
        const beforeReset = new Date(Number(data));
        const now = new Date();
        if (beforeReset.getTime() <= now.getTime()) {
            if (now.getHours() >= 7) {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 10);
            }
            else {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 7, 10);
            }
        }
        else {
            resetTime = beforeReset;
        }
    }
    else {
        const now = new Date();
        if (now.getHours() >= 7) {
            resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 10);
        }
        else {
            resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 7, 10);
        }
    }
};
const doBackup = () => __awaiter(void 0, void 0, void 0, function* () {
    while (true) {
        fs_1.default.writeFileSync(root_path + "info.json", JSON.stringify(info));
        fs_1.default.writeFileSync(root_path + "reset_time.dat", resetTime.getTime().toString());
        yield sleep(backupRefresh);
    }
});
app.listen(3000, function () {
    return __awaiter(this, void 0, void 0, function* () {
        winston_1.default.info("Twitch auth sample listening on port 3000!");
        for (const streamer of config_1.StreamerIds)
            info[streamer] = {};
        checkVideoList();
        //temp();
        setDefaultResetTime();
        yield getToken();
        stream_url_params = createStreamParams();
        checkExitValid();
        doBackup()
            .then(() => null)
            .catch(() => null);
        yield doProcess();
    });
});
