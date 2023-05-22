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
const streamerIds = [
    "paka9999",
    "dopa24",
    "pikra10",
    "xkwhd",
    "aba4647",
];
let offlineStreamers = [...streamerIds];
let info = {};
let quality = "1080p60";
const exceptGames = ["League of Legends"]; //
const refresh = 10; // 스트림을 확인하기 위해 간격(초)을 확인합니다. 소수점을 입력할 수 있습니다
const check_max = 20; // 녹음 품질을 확인할 횟수를 설정합니다. 검색횟수 이상의 녹화품질이 없을 경우 품질을 최상으로 변경하세요. 정수를 입력해야 합니다
const root_path = __dirname + "/"; // 녹화 경로 설정. thr 'r' 문자를 삭제하지 마십시오.
const quality_in_title = true; // True인 경우 제목에 품질 정보 추가
const streamlink_args = [
    "--stream-segment-threads",
    "5",
    "--stream-segment-attempts",
    "5",
    "--hls-live-restart",
    "--hls-live-edge",
    "6",
];
const InfoStatus = {
    DEFAULT: 0,
    READY: 1,
    RECORDING: 2,
    UPLOADING: 3,
    WAITING: 4,
};
Object.freeze(InfoStatus);
// Initialize Express and middlewares
var app = (0, express_1.default)();
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
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
    }
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
            for (const stream of JSON.parse(response.body)["data"]) {
                const isNew = !info[stream["user_login"]].hasOwnProperty(stream["id"]);
                let isValid = false;
                if (isNew) {
                    info[stream["user_login"]][stream["id"]] = {
                        title: stream["title"],
                        game: [stream["game_name"]],
                        changeTime: [new Date().getTime() / 1000],
                        quality: quality,
                        status: InfoStatus.DEFAULT,
                        fileName: [stream["id"]],
                        pat: undefined,
                        patCheck: 0,
                        procs: undefined,
                    };
                }
                const isExceptGame = exceptGames.includes(stream["game_name"]);
                const isRecording = info[stream["user_login"]][stream["id"]]["status"] ===
                    InfoStatus.RECORDING;
                const isWaiting = info[stream["user_login"]][stream["id"]]["status"] ===
                    InfoStatus.WAITING;
                const isNewGame = info[stream["user_login"]][stream["id"]].game.at(-1) !==
                    stream["game_name"];
                if (isNew && !isExceptGame)
                    isValid = yield checkQuality(stream["user_login"], stream["id"]);
                else if (isNew && isExceptGame)
                    info[stream["user_login"]][stream["id"]]["status"] =
                        InfoStatus.WAITING;
                if (isValid)
                    info[stream["user_login"]][stream["id"]]["status"] = InfoStatus.READY;
                if (isExceptGame && isRecording) {
                    info[stream["user_login"]][stream["id"]]["status"] =
                        InfoStatus.WAITING;
                    (_d = info[stream["user_login"]][stream["id"]]["procs"]) === null || _d === void 0 ? void 0 : _d.kill(2);
                    delete info[stream["user_login"]][stream["id"]]["procs"];
                    info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                    info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                    return;
                }
                if (!isExceptGame && isRecording && isNewGame) {
                    info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                    info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                    return;
                }
                if (!isExceptGame && isWaiting) {
                    info[stream["user_login"]][stream["id"]]["game"].push(stream["game_name"]);
                    info[stream["user_login"]][stream["id"]]["changeTime"].push(new Date().getTime() / 1000);
                    info[stream["user_login"]][stream["id"]].status = InfoStatus.READY;
                    if (info[stream["user_login"]][stream["id"]].fileName.length > 1)
                        info[stream["user_login"]][stream["id"]].fileName.push(info[stream["user_login"]][stream["id"]].fileName[0] +
                            "_" +
                            info[stream["user_login"]][stream["id"]].fileName.length);
                    return;
                }
                offlineStreamers = offlineStreamers.filter((element) => element !== stream["user_login"]);
                winston_1.default.info(stream["user_login"] + " is online");
            }
            for (const offlineStreamer of offlineStreamers) {
                for (const vidId in info[offlineStreamer]) {
                    const isWaiting = info[offlineStreamer][vidId]["status"] === InfoStatus.WAITING;
                    const isDefault = info[offlineStreamer][vidId]["status"] === InfoStatus.DEFAULT;
                    if (isWaiting) {
                        info[offlineStreamer][vidId] = Object.assign(Object.assign({}, info[offlineStreamer][vidId]), { status: InfoStatus.UPLOADING });
                        yield mergeVideo(offlineStreamer, vidId);
                    }
                    else if (isDefault) {
                        delete info[offlineStreamer][vidId];
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
    var _e, _f, _g;
    const escape_str = [
        "\\",
        "/",
        ":",
        "*",
        "?",
        '"',
        "<",
        ">",
        "|",
        "a",
        "\b",
        "\f",
        "\n",
        "\r",
        "\t",
        "\v",
        "N",
        "U",
        "\f\r",
        "\r\n",
        "\x1c",
        "\x1d",
        "\x1e",
        "\x85",
        "\u2028",
        "\u2029",
    ];
    while (true) {
        yield checkLive();
        yield sleep(refresh * 1000);
        if (info) {
            for (const id in info) {
                for (const vidId in info[id]) {
                    if (info[id][vidId]["status"] === InfoStatus.READY) {
                        winston_1.default.info(id + " is online. Stream recording in session.");
                        const downloadPath = root_path + id + "/";
                        if (!fs_1.default.existsSync(downloadPath))
                            fs_1.default.mkdirSync(downloadPath);
                        const filePath = downloadPath + info[id][vidId].fileName.at(-1) + ".ts";
                        info[id][vidId]["procs"] = (0, child_process_1.spawn)("streamlink", [
                            ...streamlink_args,
                            ...[
                                "www.twitch.tv/" + id,
                                info[id][vidId]["quality"],
                                "-o",
                                filePath,
                            ],
                        ]); //return code: 3221225786, 130
                        info[id][vidId] = Object.assign(Object.assign({}, info[id][vidId]), { status: InfoStatus.RECORDING });
                        (_f = (_e = info[id][vidId]["procs"]) === null || _e === void 0 ? void 0 : _e.stdout) === null || _f === void 0 ? void 0 : _f.on("data", (data) => {
                            winston_1.default.info(data);
                        });
                        (_g = info[id][vidId]["procs"]) === null || _g === void 0 ? void 0 : _g.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
                            delete info[id][vidId]["procs"];
                            winston_1.default.info(id + " stream is done. status: " + code);
                            info[id][vidId] = Object.assign(Object.assign({}, info[id][vidId]), { status: InfoStatus.UPLOADING });
                            mergeVideo(id, vidId);
                            // 유튜브 업로드 작업
                        }));
                        winston_1.default.info(id + " stream recording in session.");
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
            yield sleep(refresh * 1000);
        }
    }
});
const mergeVideo = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    var _h;
    if (info[id][vidId].fileName.length === 1) {
        info[id][vidId].procs = (0, child_process_1.spawn)("ffmpeg", [
            "-i",
            root_path + id + "/" + info[id][vidId].fileName[0] + ".ts",
            "-acodec",
            "copy",
            "-vcodec",
            "copy",
            root_path + id + "/" + info[id][vidId].fileName[0] + "_final.mp4",
        ]);
        (_h = info[id][vidId].procs) === null || _h === void 0 ? void 0 : _h.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
            winston_1.default.info(id + " convert to mp4 is done. status: " + code);
            delete info[id][vidId].procs;
            fs_1.default.unlink(root_path + id + "/" + info[id][vidId].fileName[0] + ".ts", (err) => {
                if (err)
                    throw err;
                winston_1.default.info(info[id][vidId].fileName[0] + " is deleted.");
            });
            yield youtubeUpload(id, vidId);
        }));
    }
    else if (info[id][vidId].fileName.length > 1) {
        const inputFile = root_path + id + "/" + info[id][vidId].fileName[0] + ".txt";
        let data = "";
        for (const fileName of info[id][vidId].fileName) {
            data += root_path + id + "/" + fileName + ".ts" + "\n";
        }
        fs_1.default.writeFile(inputFile, data, "utf8", function (error) {
            var _a;
            if (error)
                throw error;
            info[id][vidId].procs = (0, child_process_1.spawn)("ffmpeg", [
                "-safe",
                "0",
                "-f",
                "concat",
                "-i",
                inputFile,
                "-c",
                "copy",
                root_path + id + "/" + info[id][vidId].fileName[0] + "_final.mp4",
            ]); //return code: 3221225786, 130;
            (_a = info[id][vidId].procs) === null || _a === void 0 ? void 0 : _a.on("exit", (code) => __awaiter(this, void 0, void 0, function* () {
                winston_1.default.info(id + " merge is done. status: " + code);
                for (const fileName of info[id][vidId].fileName) {
                    fs_1.default.unlink(root_path + id + "/" + fileName + ".ts", (err) => {
                        if (err)
                            throw err;
                        winston_1.default.info(fileName + " is deleted.");
                    });
                }
                fs_1.default.unlink(root_path + id + "/" + info[id][vidId].fileName[0] + ".txt", (err) => {
                    if (err)
                        throw err;
                    winston_1.default.info(root_path +
                        id +
                        "/" +
                        info[id][vidId].fileName[0] +
                        ".txt" +
                        " is deleted.");
                });
                delete info[id][vidId].procs;
                yield youtubeUpload(id, vidId);
            }));
        });
    }
});
const youtubeUpload = (id, vidId) => __awaiter(void 0, void 0, void 0, function* () {
    const recordAt = new Date(info[id][vidId]["changeTime"][0] * 1000);
    const utc = recordAt.getTime() + recordAt.getTimezoneOffset() * 60 * 1000;
    // 3. UTC to KST (UTC + 9시간)
    const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
    const kr_curr = new Date(utc + KR_TIME_DIFF);
    const title = id + "-" + kr_curr.toLocaleString() + "_" + info[id][vidId]["title"];
    const exceptGameIndex = [];
    let fromIndex = 0;
    for (const exceptGame of exceptGames) {
        while (fromIndex !== -1) {
            fromIndex = info[id][vidId].game.indexOf(exceptGame, fromIndex);
            exceptGameIndex.push(fromIndex);
        }
    }
    const checkFps = (0, child_process_1.spawn)("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate",
        "-of",
        "default=nw=1:nk=1",
        root_path + id + "/" + info[id][vidId].fileName[0] + "_final.mp4",
    ]);
    checkFps.stdout.on("data", (data) => {
        winston_1.default.info(data);
        const data2 = String(data).split("/");
        const fps = Number(data2[0]) / Number(data2[1]);
        winston_1.default.info(info[id][vidId].fileName[0] + "_final.mp4" + " fps: " + fps);
    });
    let description = "00:00:00 ";
    let startAt = 0;
    let endAt = 0;
    if (info[id][vidId]["game"].length === 1) {
        description += "~ final " + info[id][vidId].game[0] + "\n";
    }
    else {
        endAt = info[id][vidId]["changeTime"][1] - info[id][vidId]["changeTime"][0];
        if (exceptGameIndex[0] === 0)
            endAt = 0;
        const hour = Math.floor(endAt / 3600);
        const minute = Math.floor((endAt % 3600) / 60);
        const seconds = Math.floor((endAt % 3600) % 60);
        description +=
            "~ " +
                String(hour).padStart(2, "0") +
                ":" +
                String(minute).padStart(2, "0") +
                ":" +
                String(seconds).padStart(2, "0") +
                " " +
                info[id][vidId].game[0] +
                "\n";
    }
    for (let i = 1; i < info[id][vidId]["game"].length - 1; i++) {
        startAt = endAt;
        let isExceptTime = false;
        for (const index of exceptGameIndex) {
            if (i === index) {
                isExceptTime = true;
            }
        }
        if (!isExceptTime)
            endAt +=
                info[id][vidId]["changeTime"][i + 1] - info[id][vidId]["changeTime"][i];
        const startHour = Math.floor(startAt / 3600);
        const startMinute = Math.floor((startAt % 3600) / 60);
        const startSeconds = Math.floor((startAt % 3600) % 60);
        const endHour = Math.floor(endAt / 3600);
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
                " ";
        info[id][vidId]["game"][i] + "\n";
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
    const media = fs_1.default.createReadStream(root_path + id + "/" + info[id][vidId].fileName[0] + "_final.mp4");
    winston_1.default.info(root_path + id + "/" + info[id][vidId].fileName[0] + "_fianl.mp4");
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
    youtube.videos.insert(config, (err, data) => {
        if (err)
            winston_1.default.error("err: " + err);
        else {
            winston_1.default.info("response: " + JSON.stringify(data));
            fs_1.default.unlink(root_path + id + "/" + info[id][vidId].fileName[0] + "_final.mp4", (err) => {
                if (err)
                    throw err;
                winston_1.default.info(root_path +
                    id +
                    "/" +
                    info[id][vidId].fileName[0] +
                    "_final.mp4" +
                    " is deleted.");
            });
            delete info[id][vidId];
        }
    });
    winston_1.default.info("uploading ");
});
process.on("exit", (code) => {
    winston_1.default.info(`exit code : ${code}`);
    fs_1.default.writeFileSync(root_path + "info.json", JSON.stringify(info));
    winston_1.default.info(`info.json : ${info}`);
    revokeToken();
    if (code !== 0) {
        winston_1.default.info({
            exitCode: code,
            message: "I'm gone",
            timestamp: new Date(),
        });
    }
});
app.set("view engine", "ejs");
app.set("index", "./views/index");
app.get("/", function (req, res) {
    res.render("index", {
        info,
        streamerIds,
        InfoStatus,
        StatusMessage: ["온라인", "준비 중", "녹화 중", "업로딩 중", "대기 중"],
        errorCount: errorCount,
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
const checkVideoList = () => __awaiter(void 0, void 0, void 0, function* () {
    if (fs_1.default.existsSync(root_path + "info.json"))
        info = yield (yield fetch(root_path + "info.json")).json();
});
app.listen(3000, function () {
    return __awaiter(this, void 0, void 0, function* () {
        winston_1.default.info("Twitch auth sample listening on port 3000!");
        yield checkVideoList();
        for (const streamer of streamerIds)
            info[streamer] = {};
        yield getToken();
        stream_url_params = createStreamParams(streamerIds);
        yield doProcess();
    });
});
