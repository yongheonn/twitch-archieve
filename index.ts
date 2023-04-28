import express from 'express';
import request from "request";

// Define our constants, you will change these with your own
const TWITCH_CLIENT_ID = "6gkwj5guq4a5vjbpd181ksilve9km5";
const TWITCH_SECRET = "s8gfl3lvjq557d3klnrn73wecqejpj";

let access_token = "";
let stream_url_params = '';
const streamerIds: string[] = [];

type Stream = {
    user_login: string;
    title: string;
    game_name: string;
}

// Initialize Express and middlewares
var app = express();

const getToken = () => {
  const option = {
    url:
      "https://id.twitch.tv/oauth2/token?client_id=" +
      TWITCH_CLIENT_ID +
      "&client_secret=" +
      TWITCH_SECRET +
      "&grant_type=client_credentials",
  };
  console.log("start access token get");

  request.post(option, function (error, response, body) {
    if (response && response.statusCode == 200) {
      access_token = JSON.parse(body)["access_token"];
      console.log("success get access token: " + access_token);
    } else {
      console.log("fail get access token");
      console.log(error);
    }
  });
};

const revokeToken = () => {
  const option = {
    url:
      "https://id.twitch.tv/oauth2/revoke?client_id=" +
      TWITCH_CLIENT_ID +
      "&token=" +
      access_token,
  };
  console.log("start access token revoke");

  request.post(option, function (error, response) {
    if (response && response.statusCode == 200) {
      access_token = "";
      console.log("success revoke access token");
    } else {
      console.log("fail revoke access token");
      console.log(error);
    }
  });
};

const createStreamParams = (streamerIds: string[]) => {
  let params = ''
    for (const id in streamerIds)
      params = params + '&user_login=' + id;
    return params.slice(1)
}

const setStreamLinkArgs = () => {
  // apply custom options to streamlink
  const streamlink_args = [
    "streamlink",
    "--stream-segment-threads",
    "5",
    "--stream-segment-attempts",
    "5",
    "--twitch-disable-ads",
    "--hls-live-restart",
    "--hls-live-edge",
    "6",
  ];
  const streamlink_quality_args = ["streamlink"];
  if (oauth != "")
    streamlink_args.push(
      ...[
        "--twitch-api-header",
        "Authorization=OAuth {}".format(self.oauth.strip()),
      ]
    );
  //del self.oauth
  if (custom_options != "")
    //self.custom_options = self.custom_options.strip().replace(',', '').split(' ')
    custom_options = shlex.split(
      self.custom_options.strip().replace(",", ""),
      (posix = True)
    );
  if ("--http-proxy" in custom_options)
    //#self.legacy_func = True
    streamlink_quality_args.push("--http-proxy");
  streamlink_quality_args.push(
    custom_options[custom_options.index("--http-proxy") + 1]
  );
  self.proxies = {
    http: self.custom_options[self.custom_options.index("--http-proxy") + 1],
    https: self.custom_options[self.custom_options.index("--http-proxy") + 1],
  };
  streamlink_args.push(...custom_options);
};

const checkLive = () => {
  try {
    const option = {
        url:
        'https://api.twitch.tv/helix/streams?' + stream_url_params,
        headers: {
            'Authorization': 'Bearer {self.user_token}', 'Client-Id': TWITCH_CLIENT_ID
          },
      };
      info = dict()
      if (streamerIds != null)
        request.get(option, function (error, response, body) {
            if (response && response.statusCode == 200) {
                
                for (const stream of (JSON.parse(body)["data"] as Stream[])){
                if (self.check_quality(stream['user_login']))
                  info[stream['user_login']] = {'title': stream['title'], 'game': stream['game_name']}
                  self.streamerID.remove(i['user_login'])
            }
              self.url_params = self.create_params(self.streamerID)
            
            } else {
              console.log("fail get access token");
              console.log(error);
            }
          });

        # unauthorized : token expired
        if res.status_code == requests.codes.unauthorized:
          self.user_token = self.create_token()
          res_message = res.json()['message']
          self.print_log(self.logger, 'error', f" {res_message}. regenerate token...", f"{res_message}. regenerate token...")
        
        # bad_request : invalid client id or client secret
        elif res.status_code == requests.codes.bad_request:
          raise Exception(res.json()['message'])
        
        # too_many_requests : api rate limit exceeded wait until reset time
        elif res.status_code == requests.codes.too_many_requests:
          self.print_log(self.logger, 'error', ' Too many request! wait until reset-time...', 'Too many request!')
          reset_time = int(res.headers['Ratelimit-Reset'])
          while(True):
            now_timestamp = time.time()
            if reset_time < now_timestamp:
              self.print_log(self.logger, 'info', ' Reset-time! continue to check...', 'Reset-time! continue to check...')
              break
            else:
              self.check_process()
              print(' Check streamlink process...', 'reset-time:', reset_time, ', now:', now_timestamp)
              time.sleep(self.refresh)
        elif res.status_code != requests.codes.ok:
          self.print_log(self.logger, 'error', ' server error(live)! status_code: {}'.format(res.status_code), 'server error(live)! status_code: {0} \n message: {1}'.format(res.status_code, res.text))
        elif res.json()['data'] == []:
          pass
        else:
          for i in res.json()['data']:
            if self.check_quality(i['user_login']):
              info[i['user_login']] = {'title': i['title'], 'game': i['game_name']}
              self.streamerID.remove(i['user_login'])
          self.url_params = self.create_params(self.streamerID)
  }
  catch(requests.exceptions.ConnectionError as ce) {
      self.print_log(self.logger, 'error', " requests.exceptions.ConnectionError. Go back checking...", f'{type(ce).__name__}: {ce}')
      info = {}
  }
    except requests.exceptions.ReadTimeout as rt:
      self.print_log(self.logger, 'error', " requests.exceptions.ReadTimeout. Go back checking...", f'{type(rt).__name__}: {rt}')
      info = {}
    return info;
}

process.on("exit", (code) => {
    console.log(`exit code : ${code}`);
    revokeToken();
  
    if (code !== 0) {
      logger.error({
        exitCode: code,
        message: "I'm gone",
        timestamp: new Date(),
      });
    }
  });

app.listen(3000, function () {
  console.log("Twitch auth sample listening on port 3000!");
  
  getToken();
  stream_url_params = createStreamParams(streamerIds);
});
