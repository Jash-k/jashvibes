# Deploy JaSH ViBeS on Koyeb

Koyeb can run this project as a Docker/Node web service. The app already listens on `0.0.0.0` and uses `${PORT:-7860}`, so it works with Koyeb when the service port is set to `7860` or when Koyeb injects `PORT`.

## Important about free sleep

Koyeb Free Instances intentionally scale to zero after idle time. Do not depend on a free instance as an always-on production server. This repository includes a lightweight health endpoint:

```txt
/api/health
```

Use it for normal health checks or manual wake checks. Avoid using automated keep-alive loops to defeat free-tier sleeping unless your Koyeb plan and Koyeb terms explicitly allow it.

## Koyeb setup

1. Push this repository to GitHub.
2. Open Koyeb Dashboard.
3. Create App / Web Service.
4. Choose GitHub repository.
5. Deployment method: Dockerfile.
6. Service type: Web Service.
7. Instance: Free, if available.
8. Port: `7860`.
9. Health check path: `/api/health`.
10. Add environment variables.

## Required environment variables

```env
DB=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
TMDB=your_tmdb_v3_api_key
PASS=your_private_password
```

## Recommended optional variables

```env
SAAVN=https://saavnapi.onrender.com
SAAVN_TIMEOUT_MS=25000
OTT=https://tamilott.vercel.app/tamil_movies.json,https://tamilott.vercel.app/tamil_dubbed.json
TAMILMV=https://www.1tamilmv.report/
PROVIDERS=tamilott,screenscape,vidlink,vidnest,videasy,vidzee,vidrock,vixsrc,oneembed,vidsrcsbs,vidsrc
```

## If cold start happens

The first request after sleep wakes the service. Wait a few seconds, then refresh. The app has retry/fallback handling for auth and music home JSON responses.

If you want zero cold starts, use an always-on paid instance or a platform/plan where always-on traffic is explicitly allowed.
