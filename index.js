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
const youtube = googleapis_1.google.youtube("v3");
// Define our constants, you will change these with your own
const TWITCH_CLIENT_ID = "6gkwj5guq4a5vjbpd181ksilve9km5";
const TWITCH_SECRET = "s8gfl3lvjq557d3klnrn73wecqejpj";
let access_token = "";
let stream_url_params = "";
let errorCount = 0;
let waitUploading = false;
const streamerIds = [
    "paka9999",
    "dopa24",
    "pikra10",
    "xkwhd",
    "aba4647",
    "tmxk319",
];
let offlineStreamers = [...streamerIds];
let info = {};
let quality = "1080p60";
let resetTime = new Date();
const exceptGames = ["League of Legends", "서버 프로그램 종료"]; //
const refresh = 10; // 스트림을 확인하기 위해 간격(초)을 확인합니다. 소수점을 입력할 수 있습니다
const check_max = 20; // 녹음 품질을 확인할 횟수를 설정합니다. 검색횟수 이상의 녹화품질이 없을 경우 품질을 최상으로 변경하세요. 정수를 입력해야 합니다
const root_path = __dirname + "/"; // 녹화 경로 설정. thr 'r' 문자를 삭제하지 마십시오.
const quality_in_title = true; // True인 경우 제목에 품질 정보 추가
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
            TWITCH_CLIENT_ID +
            "&client_secret=" +
            TWITCH_SECRET +
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
            TWITCH_CLIENT_ID +
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
const createStreamParams = (streamerIds) => {
    let params = "user_login=" + streamerIds[0];
    for (let i = 0; i < streamerIds.length; i++)
        params += "&user_login=" + streamerIds[i];
    return params.slice(1);
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
                    " quality could not be found. Check: ", +info[id][vidId].patCheck);
                if (info[id][vidId].patCheck >= check_max) {
                    info[id][vidId].quality = live_quality[0];
                    winston_1.default.info("Change " + id + " stream quality to best.");
                    info[id][vidId].patCheck = 0;
                    return true;
                }
                return false;
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
    var _d;
    try {
        const option = {
            url: "https://api.twitch.tv/helix/streams?" + stream_url_params,
            headers: {
                Authorization: "Bearer " + access_token,
                "Client-Id": TWITCH_CLIENT_ID,
            },
        };
        offlineStreamers = [...streamerIds];
        const response = yield doGetRequest(option);
        if (response && response.statusCode == 200) {
            const streamList = JSON.parse(response.body)["data"];
            for (const stream of streamList) {
                const isNew = !info[stream["user_login"]].hasOwnProperty(stream["id"]);
                let isValid = false;
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
                        winston_1.default.info(stream["user_login"] + "_" + stream["id"] + " quality check done");
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
                    info[stream["user_login"]][stream["id"]]["status"] = InfoStatus.READY;
                if (isExceptGame && isRecording) {
                    info[stream["user_login"]][stream["id"]]["status"] =
                        InfoStatus.WAITING;
                    (_d = info[stream["user_login"]][stream["id"]]["procs"]) === null || _d === void 0 ? void 0 : _d.kill(2);
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
                offlineStreamers = offlineStreamers.filter((element) => element !== stream["user_login"]);
                winston_1.default.info(stream["user_login"] + " is online");
            }
            winston_1.default.info("start check stream status");
            const vidIdList = [];
            for (const stream of streamList)
                vidIdList.push(stream.id);
            for (const streamerId of streamerIds) {
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
                    if (offlineStreamers) {
                        winston_1.default.info(offlineStreamers +
                            "is offline. Check again in " +
                            refresh +
                            " seconds.");
                        //print('Now Online:', list(self.procs.keys()))
                    }
                }
            }
            processYoutubeQueue()
                .then(() => null)
                .catch(() => null);
        }
        yield sleep(refresh);
    }
});
const processYoutubeQueue = () => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
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
                    if (new Date().getTime() < resetTime.getTime())
                        return;
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
                        if (new Date().getTime() < resetTime.getTime())
                            return;
                    }
                }
            }
        }
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
    const checkProcess = (0, child_process_1.spawn)("ffmpeg", [
        "-i",
        info[id][vidId].fileName[0] + "_final.ts",
        "2>&1",
        "|",
        "grep",
        "Duration",
        "|",
        "cut",
        "-d",
        "'",
        "'",
        "-f",
        "4",
        "|",
        "sed",
        "s/,//",
    ]); //return code: 3221225786, 130;
    let waitForCrop = true;
    let returnValue = 1;
    checkProcess.stdout.on("data", (data) => __awaiter(void 0, void 0, void 0, function* () {
        const length = data === null || data === void 0 ? void 0 : data.toString().split(":");
        if ((length === null || length === void 0 ? void 0 : length.length) === 3) {
            const hour = Number(length[0]);
            const minute = Number(length[1]);
            const second = parseFloat(length[2]);
            const quotient = Math.floor(((hour * 3600 + minute * 60 + second) / 11) * 3600);
            if (quotient >= 1) {
                cropVideo(id, vidId, quotient, length);
                returnValue = quotient + 1;
            }
        }
        waitForCrop = false;
    }));
    while (waitForCrop) {
        yield sleep(5);
    }
    return returnValue;
});
const cropVideo = (id, vidId, quotient, length) => __awaiter(void 0, void 0, void 0, function* () {
    let waitForCrop = true;
    for (let i = 0; i < quotient; i++) {
        const cropProcess = (0, child_process_1.spawn)("ffmpeg", [
            "-i",
            info[id][vidId].fileName[0] + "_final.ts",
            "-ss",
            (i * 11).toString() + ":00:00",
            "to",
            ((i + 1) * 11).toString() + ":00:00",
            "-vcodec",
            "copy",
            "-acodec",
            "copy",
            info[id][vidId].fileName[0] + "_final_" + i.toString() + ".ts",
        ]);
        cropProcess.on("exit", (result) => __awaiter(void 0, void 0, void 0, function* () {
            waitForCrop = false;
        }));
        while (waitForCrop) {
            yield sleep(5);
        }
        waitForCrop = true;
    }
    const cropProcess = (0, child_process_1.spawn)("ffmpeg", [
        "-i",
        info[id][vidId].fileName[0] + "_final.ts",
        "-ss",
        (quotient * 11).toString() + ":00:00",
        "to",
        length[0] + ":" + length[1] + ":" + length[2],
        "-vcodec",
        "copy",
        "-acodec",
        "copy",
        info[id][vidId].fileName[0] + "_final_" + quotient.toString() + ".ts",
    ]);
    cropProcess.on("exit", (result) => __awaiter(void 0, void 0, void 0, function* () {
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
    }));
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
    const title = id +
        " " +
        kr_curr.toLocaleString() +
        " " +
        info[id][vidId]["title"] +
        (num === -1 ? "" : "_" + num);
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
    const hour = Math.floor(endAt / 3600) - (num === -1 ? 0 : 11 * num * 3600);
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
    const oauth2Client = new googleapis_1.google.auth.OAuth2("1024921311743-c0facphte80lu6btgqun3u7tv2lh0aib.apps.googleusercontent.com", "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", "http://localhost:3000/redirect");
    oauth2Client.credentials = {
        access_token: "ya29.a0AWY7Cknyh54tEVh_HYSdktHT5KRGjK01nrWJebzQAz5ZtoFZ__YELhVKRHslsyNsWjKCx6ylKOec08A17BYF9MugZyHijHGTfQlF2y3DOfpQHFMlWhcF7DvBTHEqAIRusZM0t80nGsKjLtuskGlRlf7fHycJaCgYKAdASARISFQG1tDrprCZKj9Q74vA1ABcfHI1cHA0163",
        scope: "https://www.googleapis.com/auth/youtube.upload",
        token_type: "Bearer",
        refresh_token: "1//0eAK6-oupNF8mCgYIARAAGA4SNwF-L9Irybu12BeFiGFbtC-lPI1MtxUzSlr4CjE23dYI9k1htp0z1KNoOgmuUXPcnq-K3ExqM_Y",
        expiry_date: 1683881797962,
    };
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
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0);
            }
            else {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
            }
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
        }
        waitUploading = false;
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
    var _e;
    winston_1.default.info(`exit code : ${code}`);
    for (const id in info) {
        for (const vidId in info[id]) {
            if (info[id][vidId].status === InfoStatus.RECORDING) {
                info[id][vidId].status = InfoStatus.WAITING;
                (_e = info[id][vidId].procs) === null || _e === void 0 ? void 0 : _e.kill(2);
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
    var _f;
    winston_1.default.info("You've pressed Ctrl + C on this process.");
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
                    yield sleep(refresh / 5); //업로딩이 완료될 때까지 대기(delete info[id][vidId] 대기)
                }
            }
        }
    }
    fs_1.default.writeFileSync(root_path + "info.json", JSON.stringify(info));
    fs_1.default.writeFileSync(root_path + "reset_time.dat", resetTime.getTime().toString());
    winston_1.default.info(`info.json : ${info}`);
    revokeToken();
    winston_1.default.info(`exit process complete`);
}));
app.set("view engine", "ejs");
app.set("index", "./views/index");
app.get("/", function (req, res) {
    res.render("index", {
        info,
        streamerIds,
        InfoStatus,
        statusMessage: [
            "온라인",
            "준비 중",
            "녹화 중",
            "업로딩 중",
            "대기 중",
            "동영상 처리 중",
            "유튜브 업로딩 대기 중",
        ],
        errorCount: errorCount,
        resetTime: resetTime,
    });
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
const checkVideoList = () => {
    if (fs_1.default.existsSync(root_path + "info.json"))
        info = require(root_path + "info.json");
    winston_1.default.info("success to load info: " + JSON.stringify(info));
};
const setDefaultResetTime = () => {
    if (fs_1.default.existsSync(root_path + "reset_time.dat")) {
        const data = fs_1.default.readFileSync("reset_time.dat", "utf8");
        const beforeReset = new Date(Number(data));
        const now = new Date();
        if (beforeReset.getTime() <= now.getTime()) {
            if (now.getHours() >= 7) {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
            }
            else {
                resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 7, 0);
            }
        }
        else {
            resetTime = beforeReset;
        }
    }
    else {
        const now = new Date();
        if (now.getHours() >= 7) {
            resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
        }
        else {
            resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 7, 0);
        }
    }
};
const temp = () => {
    info = {
        paka9999: {},
        dopa24: {
            "40344057431": {
                title: "하위용^^",
                game: [
                    "League of Legends",
                    "Warcraft III",
                    "서버 프로그램 종료",
                    "Warcraft III",
                    "StarCraft",
                ],
                changeTime: [
                    1685366685.974, 1685377704.946, 1685384654.378, 1685384678.681,
                    1685387141.84,
                ],
                quality: "1080p60",
                status: 4,
                fileName: ["undefined_0", "undefined_0_1"],
                patCheck: 0,
                queueTime: undefined,
                num: 0,
                queueNum: 0,
            },
        },
        pikra10: {},
        xkwhd: {
            "40342447831": {
                title: "내가 C등급 1티어래요..",
                game: ["VALORANT", "서버 프로그램 종료", "VALORANT"],
                changeTime: [1685322091.435, 1685384654.378, 1685384678.681],
                quality: "1080p60",
                status: 5,
                fileName: ["40342447831", "40342447831_1"],
                pat: {
                    token: {
                        value: '{"adblock":false,"authorization":{"forbidden":false,"reason":""},"blackout_enabled":false,"channel":"xkwhd","channel_id":175163251,"chansub":{"restricted_bitrates":[],"view_until":1924905600},"ci_gb":false,"geoblock_reason":"","device_id":null,"expires":1685323291,"extended_history_allowed":false,"game":"","hide_ads":false,"https_required":true,"mature":false,"partner":false,"platform":"web","player_type":"embed","private":{"allowed_to_view":true},"privileged":false,"role":"","server_ads":true,"show_ads":true,"subscriber":false,"turbo":false,"user_id":null,"user_ip":"138.2.37.53","version":2}',
                        signature: "f199a951f63754f349520eed8bca11ddf7614b32",
                        __typename: "PlaybackAccessToken",
                    },
                    expire: 1685323291,
                },
                patCheck: 0,
                queueTime: undefined,
                num: 0,
                queueNum: 0,
            },
        },
        aba4647: {},
        tmxk319: {},
    };
};
app.listen(3000, function () {
    return __awaiter(this, void 0, void 0, function* () {
        winston_1.default.info("Twitch auth sample listening on port 3000!");
        for (const streamer of streamerIds)
            info[streamer] = {};
        checkVideoList();
        temp();
        setDefaultResetTime();
        yield getToken();
        stream_url_params = createStreamParams(streamerIds);
        yield doProcess();
    });
});
