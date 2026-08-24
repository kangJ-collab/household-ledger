# 우리집 가계부

모바일 우선으로 만든 로컬 저장형 가계부 PWA입니다.

## GitHub Pages

`main` 브랜치에 변경사항을 push하면 GitHub Actions가 `household-ledger-pwa` 폴더를 GitHub Pages에 자동 배포합니다.

저장소 설정에서 Pages의 배포 소스를 `GitHub Actions`로 선택하면 됩니다. 최초 push 이후 Actions의 `Deploy household ledger to GitHub Pages` 작업이 완료되면 공개 URL이 생성됩니다.

## 로컬 실행

```bash
cd household-ledger-pwa
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 엽니다. PWA와 서비스 워커는 `file://` 주소가 아니라 HTTP(S)에서 동작합니다.

## 데이터 보관

가계부 데이터는 현재 브라우저 `localStorage`에 저장됩니다. 여러 기기 간 실시간 동기화 서버는 연결되어 있지 않습니다.

