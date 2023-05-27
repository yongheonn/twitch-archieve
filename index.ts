import express, { response } from "express";
import request from "request";
import logger from "./winston";
import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import { google } from "googleapis";
import { Credentials } from "google-auth-library";
const youtube = google.youtube("v3");

// Define our constants, you will change these with your own
const TWITCH_CLIENT_ID = "6gkwj5guq4a5vjbpd181ksilve9km5";
const TWITCH_SECRET = "s8gfl3lvjq557d3klnrn73wecqejpj";

let access_token = "";
let stream_url_params = "";
let errorCount = 0;
let waitUploading = false;
const streamerIds: string[] = [
  "paka9999",
  "dopa24",
  "pikra10",
  "xkwhd",
  "aba4647",
  "tmxk319",
];
let offlineStreamers: string[] = [...streamerIds];
let info: Info = {};
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

interface Info {
  [key: string]: VidInfo; //user_login
}

interface VidInfo {
  [key: string]: InfoType; //id
}

interface InfoType {
  title: string;
  game: string[];
  changeTime: number[];
  queueTime: number | undefined;
  quality: string;
  status: number;
  fileName: string[];
  pat?: PatType;
  patCheck: number;
  procs?: ChildProcess;
}

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

interface PatType {
  token: TokenType;
  expire: number;
}

interface TokenType {
  value: string;
  signature: string;
  __typename: string;
}

interface Stream {
  id: string;
  user_login: string;
  title: string;
  game_name: string;
}

// Initialize Express and middlewares
var app = express();

function sleep(seconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

function doGetRequest(option: any) {
  return new Promise<request.Response>(function (resolve, reject) {
    request.get(option, function (error: any, res: request.Response) {
      if (!error && res.statusCode === 200) {
        resolve(res);
      } else {
        reject(error);
      }
    });
  });
}

function doPostRequest(option: any) {
  return new Promise<request.Response>(function (resolve, reject) {
    request.post(option, function (error: any, res: request.Response) {
      if (!error && res.statusCode === 200) {
        resolve(res);
      } else {
        reject(error);
      }
    });
  });
}

const getToken = async () => {
  const option = {
    url:
      "https://id.twitch.tv/oauth2/token?client_id=" +
      TWITCH_CLIENT_ID +
      "&client_secret=" +
      TWITCH_SECRET +
      "&grant_type=client_credentials",
  };

  const response = await doPostRequest(option);
  if (response && response.statusCode == 200) {
    access_token = JSON.parse(response.body)["access_token"];
    logger.info("success get access token: " + access_token);
  } else {
    logger.info("fail get access token");
    logger.info(response.errored);
  }
};

const revokeToken = async () => {
  const option = {
    url:
      "https://id.twitch.tv/oauth2/revoke?client_id=" +
      TWITCH_CLIENT_ID +
      "&token=" +
      access_token,
  };
  logger.info("start access token revoke");

  const response = await doPostRequest(option);
  if (response && response.statusCode == 200) {
    access_token = "";
    logger.info("success revoke access token: ");
  } else {
    logger.info("fail revoke access token");
    logger.info(response.errored);
  }
};

const createStreamParams = (streamerIds: string[]) => {
  let params = "user_login=" + streamerIds[0];
  for (let i = 0; i < streamerIds.length; i++)
    params += "&user_login=" + streamerIds[i];
  return params.slice(1);
};

const qualityParser = (m3u8: string) => {
  const quality: string[] = [];
  const m3u8_line_split = m3u8.split("\n");
  for (const m3u8_line of m3u8_line_split) {
    if (
      m3u8_line.indexOf("#EXT-X-MEDIA") !== -1 &&
      m3u8_line.indexOf("audio_only") == -1
    ) {
      quality.push(
        m3u8_line
          .split(",")[2]
          .split("=")[1]
          .replace(/"/g, "")
          .replace(" (source)", "")
      );
    }
  }
  //quality.append(['best', 'worst'])
  return quality;
};

const getPat = async (id: string, vidId: string) => {
  const url_gql = "https://gql.twitch.tv/gql";
  const stream_token_query = {
    operationName: "PlaybackAccessToken",
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash:
          "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712",
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
    const response: request.Response = await doPostRequest(option);
    if (response && response.statusCode == 200) {
      const access_token: TokenType = JSON.parse(response.body)["data"][
        "streamPlaybackAccessToken"
      ];
      try {
        const token_expire: number = Number(
          access_token["value"].split(",")[11].split(":")[1]
        );
        info[id][vidId]["pat"] = { token: access_token, expire: token_expire };
      } catch (e) {
        delete info[id][vidId]["pat"];
        logger.error(
          "error",
          "PAT expiration time error, Change self.legacy_func to True",
          "ValueError: token_expire_time"
        );
        //  self.legacy_func = True
        errorCount++;
      }
    } else {
      info[id][vidId]["patCheck"] += 1;
      return false;
    }
  } catch (e) {
    logger.error("error: " + e);
    errorCount++;
  }
};

const checkQuality = async (id: string, vidId: string) => {
  try {
    if (["best", "worst"].includes(info[id][vidId].quality)) return true;
    const twitch_headers = {
      "Client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "user-agent": "Mozilla/5.0",
    };

    const url_usher = "https://usher.ttvnw.net/api/channel/hls/" + id + ".m3u8";

    // get playback access token and get m3u8
    if (info[id][vidId]["pat"] !== undefined) {
      if (new Date().getTime() / 1000 >= info[id][vidId].pat?.expire!)
        logger.info("info", "", "Get new PAT for " + id + "_" + vidId + ".");
      delete info[id][vidId]["pat"];
    } else {
      await getPat(id, vidId);
    }

    const params_usher = {
      client_id: "kimne78kx3ncx6brgo4mv6wki5h1ko",
      token: info[id][vidId].pat?.token.value,
      sig: info[id][vidId].pat?.token.signature,
      allow_source: true,
      allow_audio_only: true,
    };
    const option = {
      url: url_usher,
      qs: params_usher,
      headers: twitch_headers,
    };

    const response = await doGetRequest(option);
    if (response && response.statusCode == 200) {
      const live_quality = qualityParser(response.body);
      logger.info("Available ttvnw quality of " + id + " : " + live_quality);

      if (!live_quality) {
        info[id][vidId].patCheck += 1;
        return false;
      } else if (quality === "best") {
        info[id][vidId].quality = live_quality[0];
        return true;
      } else if (quality === "worst") {
        info[id][vidId].quality = live_quality.at(-1) as string;
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
        logger.info(
          id +
            " stream is online. but " +
            quality +
            " quality could not be found. Check: ",
          +info[id][vidId].patCheck
        );

        if (info[id][vidId].patCheck >= check_max) {
          info[id][vidId].quality = live_quality[0];
          logger.info("Change " + id + " stream quality to best.");
          info[id][vidId].patCheck = 0;
          return true;
        }
        return false;
      }
    }
  } catch (e) {
    logger.error("quality error: " + e);
    errorCount++;
    return false;
  }
  return false;
};

const checkLive = async () => {
  try {
    const option = {
      url: "https://api.twitch.tv/helix/streams?" + stream_url_params,
      headers: {
        Authorization: "Bearer " + access_token,
        "Client-Id": TWITCH_CLIENT_ID,
      },
    };

    offlineStreamers = [...streamerIds];
    const response = await doGetRequest(option);
    if (response && response.statusCode == 200) {
      const streamList = JSON.parse(response.body)["data"] as Stream[];
      for (const stream of streamList) {
        const isNew = !info[stream["user_login"]].hasOwnProperty(stream["id"]);
        let isValid: boolean | undefined = false;
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
          };
          if (!isExceptGame) {
            isValid = await checkQuality(stream["user_login"], stream["id"]);
            logger.info(
              stream["user_login"] + "_" + stream["id"] + " quality check done"
            );
            info[stream["user_login"]][stream["id"]].fileName.push(
              stream["id"]
            );
          }
        }

        const isRecording =
          info[stream["user_login"]][stream["id"]]["status"] ===
          InfoStatus.RECORDING;
        const isWaiting =
          info[stream["user_login"]][stream["id"]]["status"] ===
          InfoStatus.WAITING;

        const isDefault =
          info[stream["user_login"]][stream["id"]]["status"] ===
          InfoStatus.DEFAULT;

        const isNewGame =
          info[stream["user_login"]][stream["id"]].game.at(-1) !==
          stream["game_name"];

        if (isValid)
          info[stream["user_login"]][stream["id"]]["status"] = InfoStatus.READY;

        if (isExceptGame && isRecording) {
          info[stream["user_login"]][stream["id"]]["status"] =
            InfoStatus.WAITING;
          info[stream["user_login"]][stream["id"]]["procs"]?.kill(2);
          delete info[stream["user_login"]][stream["id"]]["procs"];
          info[stream["user_login"]][stream["id"]]["game"].push(
            stream["game_name"]
          );
          info[stream["user_login"]][stream["id"]]["changeTime"].push(
            new Date().getTime() / 1000
          );
          continue;
        }

        if (!isExceptGame && isRecording && isNewGame) {
          info[stream["user_login"]][stream["id"]]["game"].push(
            stream["game_name"]
          );
          info[stream["user_login"]][stream["id"]]["changeTime"].push(
            new Date().getTime() / 1000
          );
          continue;
        }

        if (
          !isExceptGame &&
          (isWaiting ||
            (isDefault &&
              exceptGames.includes(
                info[stream["user_login"]][stream["id"]].game[0]
              )))
        ) {
          info[stream["user_login"]][stream["id"]]["game"].push(
            stream["game_name"]
          );
          info[stream["user_login"]][stream["id"]]["changeTime"].push(
            new Date().getTime() / 1000
          );
          info[stream["user_login"]][stream["id"]].status = InfoStatus.READY;
          info[stream["user_login"]][stream["id"]].fileName.push(
            info[stream["user_login"]][stream["id"]].fileName[0] +
              "_" +
              info[stream["user_login"]][stream["id"]].fileName.length
          );
          continue;
        }

        offlineStreamers = offlineStreamers.filter(
          (element) => element !== stream["user_login"]
        );
        logger.info(stream["user_login"] + " is online");
      }
      logger.info("start check stream status");
      const vidIdList = [];
      for (const stream of streamList) vidIdList.push(stream.id);
      for (const streamerId of streamerIds) {
        for (const vidId in info[streamerId]) {
          const isWaiting =
            info[streamerId][vidId]["status"] === InfoStatus.WAITING;
          const isDefault =
            info[streamerId][vidId]["status"] === InfoStatus.DEFAULT;
          const isReady =
            info[streamerId][vidId]["status"] === InfoStatus.READY;
          if (!vidIdList.includes(vidId)) {
            if (isWaiting) {
              info[streamerId][vidId] = {
                ...info[streamerId][vidId],
                status: InfoStatus.MERGING,
              };
              mergeVideo(streamerId, vidId);
            } else if (isDefault || isReady) {
              delete info[streamerId][vidId];
            }
          }
        }
      }
    } else if (response.statusCode === 401) {
      await getToken();
      const res_message = JSON.parse(response.body)["message"];
      logger.info("error 401: " + res_message + ". regenerate token...");
    } else if (response.statusCode === 400) {
      const res_message = JSON.parse(response.body)["message"];
      logger.info("error 400: " + res_message);
    } else if (response.statusCode === 429) {
      logger.info("Too many request! wait until reset-time...");
      const reset_time = Number(response.headers["Ratelimit-Reset"]);
      while (true) {
        const now_timestamp = new Date().getTime() / 1000;
        if (reset_time < now_timestamp) {
          logger.info(
            "Reset-time! continue to check...",
            "Reset-time! continue to check..."
          );
          break;
        } else {
          logger.info(
            "Check streamlink process... " +
              "reset-time: " +
              reset_time +
              ", now: " +
              now_timestamp
          );
        }
      }
    } else {
      logger.info(
        "server error(live)! status_code: " +
          response.statusCode +
          "\n message: " +
          response.body
      );
    }
  } catch (e) {
    logger.error(
      " requests.exceptions.ConnectionError. Go back checking...  message: " + e
    );
    errorCount++;
  }
};

const doProcess = async () => {
  while (true) {
    await checkLive();
    await sleep(refresh);
    if (info) {
      for (const id in info) {
        for (const vidId in info[id]) {
          if (info[id][vidId]["status"] === InfoStatus.READY) {
            recordStream(id, vidId);
          }
          if (offlineStreamers) {
            logger.info(
              offlineStreamers +
                "is offline. Check again in " +
                refresh +
                " seconds."
            );
            //print('Now Online:', list(self.procs.keys()))
          }
        }
      }
      processYoutubeQueue()
        .then(() => null)
        .catch(() => null);
    }
  }
};

const processYoutubeQueue = async () => {
  const now = new Date();
  if (now.getTime() > resetTime.getTime()) {
    let sortObj = [];
    for (const id in info) {
      for (const vidId in info[id]) {
        if (info[id][vidId].status == InfoStatus.QUEUE) {
          sortObj.push([info[id][vidId].queueTime, id, vidId]);
        }
      }
    }
    sortObj.sort(function (a: any, b: any) {
      return b[0] - a[0];
    });
    if (sortObj) {
      for (const queue of sortObj) {
        youtubeUpload(queue[1] as string, queue[2] as string);
        while (waitUploading) {
          await sleep(5);
        }
        if (new Date().getTime() < resetTime.getTime()) return;
      }
    }
  }
};

const recordStream = (id: string, vidId: string) => {
  logger.info(id + " is online. Stream recording in session.");
  const downloadPath = root_path + id + "/";
  if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

  const filePath = downloadPath + info[id][vidId].fileName.at(-1) + ".ts";

  info[id][vidId]["procs"] = spawn("streamlink", [
    ...streamlink_args,
    ...["www.twitch.tv/" + id, info[id][vidId]["quality"], "-o", filePath],
  ]); //return code: 3221225786, 130

  info[id][vidId] = {
    ...info[id][vidId],
    status: InfoStatus.RECORDING,
  };

  info[id][vidId]["procs"]?.stdout?.on("data", (data) => {
    logger.info(data);
  });

  info[id][vidId]["procs"]?.on("exit", async (code) => {
    logger.info(id + " stream is done. status: " + code);
    if (code == 0 || code == 1) {
      delete info[id][vidId]["procs"];

      delete info[id][vidId].procs;
      info[id][vidId] = {
        ...info[id][vidId],
        status: InfoStatus.MERGING,
      };
      mergeVideo(id, vidId);
    }
  });

  logger.info(id + " stream recording in session.");
};

const mergeVideo = (id: string, vidId: string) => {
  try {
    logger.info(id + "_" + vidId + " merge start");
    if (info[id][vidId].fileName.length === 1) {
      fs.renameSync(
        root_path + id + "/" + info[id][vidId].fileName[0] + ".ts",
        root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts"
      );

      logger.info(id + "_" + vidId + " rename done");
      enqueue(id, vidId);
    } else if (info[id][vidId].fileName.length > 1) {
      const inputFile =
        root_path + id + "/" + info[id][vidId].fileName[0] + ".txt";
      let data = "";
      for (const fileName of info[id][vidId].fileName) {
        data += "file " + fileName + ".ts" + "\n";
      }
      fs.writeFileSync(inputFile, data, "utf8");
      info[id][vidId].procs = spawn("ffmpeg", [
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
      info[id][vidId].procs?.stdout?.on("data", (data) => {
        logger.info(data);
      });
      info[id][vidId].procs?.on("exit", async (code) => {
        logger.info(id + " merge is done. status: " + code);
        for (const fileName of info[id][vidId].fileName) {
          fs.unlink(root_path + id + "/" + fileName + ".ts", (err) => {
            if (err) {
              logger.error(id + "_" + fileName + " ts delete error");
              throw err;
            }

            logger.info(fileName + " is deleted.");
          });
        }
        fs.unlink(
          root_path + id + "/" + info[id][vidId].fileName[0] + ".txt",
          (err) => {
            if (err) {
              logger.error(
                id + "_" + info[id][vidId].fileName[0] + ".txt delete error"
              );
              throw err;
            }

            logger.info(
              root_path +
                id +
                "/" +
                info[id][vidId].fileName[0] +
                ".txt" +
                " is deleted."
            );
          }
        );
        delete info[id][vidId].procs;
        enqueue(id, vidId);
      });
    }
  } catch (e) {
    logger.error(e);
    errorCount++;
  }
};

const youtubeUpload = (id: string, vidId: string) => {
  waitUploading = true;
  const recordAt = new Date(info[id][vidId]["changeTime"][0] * 1000);
  const utc = recordAt.getTime() + recordAt.getTimezoneOffset() * 60 * 1000;

  logger.info(id + "_" + vidId + " youtube upload start");
  // 3. UTC to KST (UTC + 9시간)
  const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
  const kr_curr = new Date(utc + KR_TIME_DIFF);
  const title =
    id + " " + kr_curr.toLocaleString() + " " + info[id][vidId]["title"];
  const exceptGameIndex = [];
  let fromIndex = 0;
  for (const exceptGame of exceptGames) {
    while (true) {
      fromIndex = info[id][vidId].game.indexOf(exceptGame, fromIndex);
      exceptGameIndex.push(fromIndex);
      if (fromIndex === -1) break;
      fromIndex++;
    }
  }

  let description = "00:00:00 ";

  let startAt = 0;
  let endAt = 0;

  if (info[id][vidId]["game"].length === 1) {
    description += "~ final " + info[id][vidId].game[0] + "\n";
  } else {
    endAt = info[id][vidId]["changeTime"][1] - info[id][vidId]["changeTime"][0];
    if (exceptGameIndex[0] === 0) endAt = 0;
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
      " " +
      info[id][vidId]["game"][i] +
      "\n";
  }
  if (info[id][vidId]["game"].length > 1) {
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
  }
  logger.info(id + "_" + vidId + " readStream start");
  const media = fs.createReadStream(
    root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts"
  );
  logger.info(root_path + id + "/" + info[id][vidId].fileName[0] + "_fianl.ts");

  const oauth2Client = new google.auth.OAuth2(
    "1024921311743-c0facphte80lu6btgqun3u7tv2lh0aib.apps.googleusercontent.com",
    "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",
    "http://localhost:3000/redirect"
  );

  oauth2Client.credentials = {
    access_token:
      "ya29.a0AWY7Cknyh54tEVh_HYSdktHT5KRGjK01nrWJebzQAz5ZtoFZ__YELhVKRHslsyNsWjKCx6ylKOec08A17BYF9MugZyHijHGTfQlF2y3DOfpQHFMlWhcF7DvBTHEqAIRusZM0t80nGsKjLtuskGlRlf7fHycJaCgYKAdASARISFQG1tDrprCZKj9Q74vA1ABcfHI1cHA0163",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    token_type: "Bearer",
    refresh_token:
      "1//0eAK6-oupNF8mCgYIARAAGA4SNwF-L9Irybu12BeFiGFbtC-lPI1MtxUzSlr4CjE23dYI9k1htp0z1KNoOgmuUXPcnq-K3ExqM_Y",
    expiry_date: 1683881797962,
  } as Credentials;

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
  logger.info("upload start ");
  info[id][vidId].status = InfoStatus.UPLOADING;
  youtube.videos.insert(config, (err: any, data: any) => {
    if (err) {
      logger.error("err: uploading error: " + err);
      info[id][vidId].status = InfoStatus.QUEUE;
      const now = new Date();
      if (now.getHours() >= 7) {
        resetTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
          7,
          0
        );
      } else {
        resetTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          7,
          0
        );
      }
    } else {
      logger.info("response: " + JSON.stringify(data));
      fs.unlink(
        root_path + id + "/" + info[id][vidId].fileName[0] + "_final.ts",
        (err) => {
          if (err) throw err;

          logger.info(
            root_path +
              id +
              "/" +
              info[id][vidId].fileName[0] +
              "_final.ts" +
              " is deleted."
          );
          delete info[id][vidId];
        }
      );
    }
    waitUploading = false;
  });

  logger.info("uploading ");
};

const enqueue = (id: string, vidId: string) => {
  info[id][vidId].status = InfoStatus.QUEUE;
  info[id][vidId].queueTime = new Date().getTime();
};

process.on("exit", async (code) => {
  logger.info(`exit code : ${code}`);
  for (const id in info) {
    for (const vidId in info[id]) {
      if (info[id][vidId].status === InfoStatus.RECORDING) {
        info[id][vidId].status = InfoStatus.WAITING;
        info[id][vidId].procs?.kill(2);
        delete info[id][vidId].procs;
        info[id][vidId]["game"].push("서버 프로그램 종료");
        info[id][vidId]["changeTime"].push(new Date().getTime() / 1000);
      } else if (info[id][vidId].status === InfoStatus.UPLOADING) {
        while (vidId in info[id]) {
          await sleep(2); //업로딩이 완료될 때까지 대기(delete info[id][vidId] 대기)
        }
      }
    }
  }
  fs.writeFileSync(root_path + "info.json", JSON.stringify(info));
  fs.writeFileSync(
    root_path + "reset_time.dat",
    resetTime.getTime().toString()
  );
  logger.info(`info.json : ${info}`);
  revokeToken();
  logger.info(`exit process complete`);

  if (code !== 0) {
    logger.info({
      exitCode: code,
      message: "I'm gone",
      timestamp: new Date(),
    });
  }
});

process.once("SIGINT", async () => {
  console.log("You've pressed Ctrl + C on this process.");
  for (const id in info) {
    for (const vidId in info[id]) {
      if (info[id][vidId].status === InfoStatus.RECORDING) {
        info[id][vidId].status = InfoStatus.WAITING;
        info[id][vidId].procs?.kill(2);
        delete info[id][vidId].procs;
        info[id][vidId]["game"].push("서버 프로그램 종료");
        info[id][vidId]["changeTime"].push(new Date().getTime() / 1000);
      } else if (info[id][vidId].status === InfoStatus.UPLOADING) {
        while (vidId in info[id]) {
          await sleep(refresh / 5); //업로딩이 완료될 때까지 대기(delete info[id][vidId] 대기)
        }
      }
    }
  }
  fs.writeFileSync(root_path + "info.json", JSON.stringify(info));
  fs.writeFileSync(
    root_path + "reset_time.dat",
    resetTime.getTime().toString()
  );
  logger.info(`info.json : ${info}`);
  revokeToken();
  logger.info(`exit process complete`);
});

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
  if (fs.existsSync(root_path + "info.json"))
    info = require(root_path + "info.json");

  logger.info("success to load info: " + JSON.stringify(info));
};

const setDefaultResetTime = () => {
  if (fs.existsSync(root_path + "reset_time.dat")) {
    const data = fs.readFileSync("reset_time.dat", "utf8");
    const beforeReset = new Date(Number(data));
    const now = new Date();

    if (beforeReset.getTime() <= now.getTime()) {
      if (now.getHours() >= 7) {
        resetTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          7,
          0
        );
      } else {
        resetTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 1,
          7,
          0
        );
      }
    } else {
      resetTime = beforeReset;
    }
  } else {
    const now = new Date();
    if (now.getHours() >= 7) {
      resetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        7,
        0
      );
    } else {
      resetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
        7,
        0
      );
    }
  }
};

const temp = () => {
  info = {
    paka9999: {},
    dopa24: {
      "40335101095": {
        title: "5시 언저리",
        game: ["Warcraft III", "StarCraft", "League of Legends", "StarCraft"],
        changeTime: [
          1685110858.562, 1685111306.015, 1685115871.087, 1685122048.779,
        ],
        quality: "1080p60",
        status: 6,
        fileName: ["40335101095", "40335101095_1"],
        pat: {
          token: {
            value:
              '{"adblock":false,"authorization":{"forbidden":false,"reason":""},"blackout_enabled":false,"channel":"dopa24","channel_id":536083731,"chansub":{"restricted_bitrates":["archives"],"view_until":1924905600},"ci_gb":false,"geoblock_reason":"","device_id":null,"expires":1685112058,"extended_history_allowed":false,"game":"","hide_ads":false,"https_required":true,"mature":false,"partner":false,"platform":"web","player_type":"embed","private":{"allowed_to_view":true},"privileged":false,"role":"","server_ads":true,"show_ads":true,"subscriber":false,"turbo":false,"user_id":null,"user_ip":"138.2.37.53","version":2}',
            signature: "953033317b18a5fe8c1f9405f11ee361e506a497",
            __typename: "PlaybackAccessToken",
          },
          expire: 1685112058,
        },
        patCheck: 0,
        queueTime: 1685120650000,
      },
    },
    pikra10: {
      "40337443591": {
        title: "토요일",
        game: ["Just Chatting", "서버 프로그램 종료"],
        changeTime: [1685164066.66, 1685173188.174],
        quality: "1080p60",
        status: 4,
        fileName: ["40337443591"],
        pat: {
          token: {
            value:
              '{"adblock":false,"authorization":{"forbidden":false,"reason":""},"blackout_enabled":false,"channel":"pikra10","channel_id":194230187,"chansub":{"restricted_bitrates":["archives"],"view_until":1924905600},"ci_gb":false,"geoblock_reason":"","device_id":null,"expires":1685165266,"extended_history_allowed":false,"game":"","hide_ads":false,"https_required":true,"mature":false,"partner":false,"platform":"web","player_type":"embed","private":{"allowed_to_view":true},"privileged":false,"role":"","server_ads":true,"show_ads":true,"subscriber":false,"turbo":false,"user_id":null,"user_ip":"138.2.37.53","version":2}',
            signature: "58df2742c912985d6f85ea6fe7152fcbf6b6a6d3",
            __typename: "PlaybackAccessToken",
          },
          expire: 1685165266,
        },
        patCheck: 0,
        queueTime: undefined,
      },
    },
    xkwhd: {
      "40335613015": {
        title: "9시 발로란트 고수내전",
        game: ["VALORANT"],
        changeTime: [1685110858.885],
        quality: "1080p60",
        status: 6,
        fileName: ["40335613015"],
        pat: {
          token: {
            value:
              '{"adblock":false,"authorization":{"forbidden":false,"reason":""},"blackout_enabled":false,"channel":"xkwhd","channel_id":175163251,"chansub":{"restricted_bitrates":[],"view_until":1924905600},"ci_gb":false,"geoblock_reason":"","device_id":null,"expires":1685112058,"extended_history_allowed":false,"game":"","hide_ads":false,"https_required":true,"mature":false,"partner":false,"platform":"web","player_type":"embed","private":{"allowed_to_view":true},"privileged":false,"role":"","server_ads":true,"show_ads":true,"subscriber":false,"turbo":false,"user_id":null,"user_ip":"138.2.37.53","version":2}',
            signature: "dcd84f7b351ec0df0090f5e2a551a5215de5ee4d",
            __typename: "PlaybackAccessToken",
          },
          expire: 1685112058,
        },
        patCheck: 0,
        queueTime: 1685120640000,
      },
    },
    aba4647: {},
    tmxk319: {},
  };
};

app.listen(3000, async function () {
  logger.info("Twitch auth sample listening on port 3000!");
  console.log(new Date(2023, 4, 27, 2, 4).getTime());
  for (const streamer of streamerIds) info[streamer] = {};
  checkVideoList();
  temp();
  setDefaultResetTime();
  await getToken();
  stream_url_params = createStreamParams(streamerIds);
  await doProcess();
});
