(function() {
    'use strict';

    var fxapi_token = Lampa.Storage.get('fxapi_token', '');
    var unic_id = Lampa.Storage.get('fxapi_uid', '');
    if (!unic_id) {
        unic_id = Lampa.Utils.uid(16);
        Lampa.Storage.set('fxapi_uid', unic_id);
    }

    var proxy_url = 'http://cors.byskaz.ru/';
    var api_url = 'http://filmixapp.vip/api/v2/';
    var dev_token = 'user_dev_apk=2.0.1&user_dev_id=' + unic_id + '&user_dev_name=Lampa&user_dev_os=11&user_dev_vendor=FXAPI&user_dev_token=';
    var modalopen = false;
    var ping_auth;

    var search_cache = {};
    var cache_timeout = 1000 * 60 * 30;

    function getOptimalQuality() {
        var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        var speed = Lampa.Storage.get('network_speed', 'auto');
        if (speed !== 'auto') return parseInt(speed);
        if (connection) {
            var effectiveType = connection.effectiveType;
            if (effectiveType === '4g') return 1080;
            if (effectiveType === '3g') return 720;
            if (effectiveType === '2g') return 480;
        }
        return 1080;
    }

    function fxapi(component, _object) {
        var network = new Lampa.Reguest();
        var extract = {};
        var results = [];
        var object = _object;
        var wait_similars;
        var filter_items = {};
        var choice = { season: 0, voice: 0, voice_name: '' };

        if (!fxapi_token) {
            var user_code = '';
            var user_token = '';
            var auth_timestamp = Lampa.Storage.get('fxapi_auth_time', 0);
            var current_time = Date.now();

            if (current_time - auth_timestamp < 30 * 24 * 60 * 60 * 1000) {
                fxapi_token = Lampa.Storage.get('fxapi_token', '');
            }

            modalopen = true;
            var modal = $('<div><div class="broadcast__text">Для використання Filmix введіть код на сайті <b>filmix.my/consoles</b></div><div class="broadcast__device selector" style="text-align: center; background-color: darkslategrey; color: white;">Очікування...</div><br><div class="broadcast__scan"><div></div></div></div></div>');

            function openModal(){
                var contrl = Lampa.Controller.enabled().name
                Lampa.Modal.open({
                    title: 'Авторизація Filmix',
                    html: modal,
                    onBack: function onBack() {
                        Lampa.Modal.close();
                        clearInterval(ping_auth);
                        Lampa.Controller.toggle(contrl)
                    },
                    onSelect: function onSelect() {
                        Lampa.Utils.copyTextToClipboard(user_code, function() {
                            Lampa.Noty.show('Код скопійовано!');
                        }, function() {
                            Lampa.Noty.show('Помилка копіювання');
                        });
                    }
                });
            }

            ping_auth = setInterval(function() {
                network.silent(Lampa.Utils.addUrlComponent(api_url + 'user_profile', dev_token + user_token), function(json) {
                    if (json && json.user_data) {
                        Lampa.Modal.close();
                        clearInterval(ping_auth);
                        Lampa.Storage.set("fxapi_token", user_token);
                        Lampa.Storage.set("fxapi_auth_time", Date.now());
                        window.location.reload();
                    }
                }, function(a, c) {});
            }, 2000);

            network.quiet(Lampa.Utils.addUrlComponent(api_url + 'token_request', dev_token), function(found) {
                if (found.status == 'ok') {
                    user_token = found.code;
                    user_code = found.user_code;
                    modal.find('.selector').text(user_code);
                    if(!$('.modal').length) openModal()
                } else {
                    Lampa.Noty.show('Помилка отримання коду: ' + (found.message || 'Невідома помилка'));
                }
            }, function(a, c) {
                Lampa.Noty.show('Помилка з\'єднання з Filmix');
            });
            component.loading(false);
            return;
        }

        this.search = function(_object, sim) { if (wait_similars) this.find(sim[0].id); };

        function normalizeString(str) { return str.toLowerCase().replace(/[^a-zа-я0-9]/g, ''); }

        this.searchByTitle = function(_object, query) {
            var _this = this;
            object = _object;
            var cache_key = 'filmix_search_' + query;
            var cached = search_cache[cache_key];
            if (cached && (Date.now() - cached.timestamp < cache_timeout)) {
                processSearchResults(cached.data);
                return;
            }
            var year = parseInt((object.movie.release_date || object.movie.first_air_date || '0000').slice(0, 4));
            var orig = object.movie.original_name || object.movie.original_title;
            var url = api_url + 'search';
            url = Lampa.Utils.addUrlComponent(url, 'story=' + encodeURIComponent(query));
            url = Lampa.Utils.addUrlComponent(url, dev_token + fxapi_token);

            network.clear();
            network.timeout(15000);
            network.silent(url, function(json) {
                search_cache[cache_key] = { data: json, timestamp: Date.now() };
                processSearchResults(json);
            }, function(a, c) {
                if (a.status === 401) {
                    Lampa.Noty.show('Помилка авторизації. Увійдіть знову');
                    Lampa.Storage.set('fxapi_token', '');
                    window.location.reload();
                } else component.doesNotAnswer();
            });

            function processSearchResults(json) {
                var cards = json.filter(function(c) {
                    c.year = parseInt(c.alt_name.split('-').pop());
                    return c.year > year - 2 && c.year < year + 2;
                });
                var card = cards.find(function(c) {
                    return c.year == year && normalizeString(c.original_title) == normalizeString(orig);
                });
                if (!card && cards.length == 1) card = cards[0];
                if (card) _this.find(card.id);
                else if (json.length) {
                    wait_similars = true;
                    component.similars(json);
                    component.loading(false);
                } else component.doesNotAnswer();
            }
        };

        this.find = function(filmix_id) {
            var url = proxy_url + api_url;
            end_search(filmix_id);
            function end_search(filmix_id) {
                network.clear();
                network.timeout(10000);
                network.silent(url + 'post/' + filmix_id + '?' + dev_token + fxapi_token, function(found) {
                    if (found && Object.keys(found).length) {
                        success(found);
                        component.loading(false);
                    } else component.doesNotAnswer();
                }, function(a, c) {
                    if (a.status === 401) {
                        Lampa.Noty.show('Сесія застаріла. Увійдіть знову');
                        Lampa.Storage.set('fxapi_token', '');
                    }
                    component.doesNotAnswer();
                });
            }
        };

        this.extendChoice = function(saved) { Lampa.Arrays.extend(choice, saved, true); };
        this.reset = function() {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            extractData(results);
            filter();
            append(filtred());
        };
        this.filter = function(type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice') choice.voice_name = filter_items.voice[b.index];
            component.reset();
            extractData(results);
            filter();
            append(filtred());
        };
        this.destroy = function() { network.clear(); results = null; };

        function success(json) {
            results = json;
            extractData(json);
            filter();
            append(filtred());
        }

        function extractData(data) {
            extract = {};
            var pl_links = data.player_links;
            var optimal_quality = getOptimalQuality();
            if (pl_links.playlist && Object.keys(pl_links.playlist).length > 0) {
                var seas_num = 0;
                for (var season in pl_links.playlist) {
                    var episode = pl_links.playlist[season];
                    ++seas_num;
                    var transl_id = 0;
                    for (var voice in episode) {
                        var episode_voice = episode[voice];
                        ++transl_id;
                        var items = [];
                        for (var ID in episode_voice) {
                            var file_episod = episode_voice[ID];
                            var quality_eps = file_episod.qualities.filter(function(qualitys) { return qualitys <= optimal_quality; });
                            var max_quality = Math.max.apply(null, quality_eps);
                            var stream_url = file_episod.link.replace('%s.mp4', max_quality + '.mp4');
                            var s_e = stream_url.slice(0 - stream_url.length + stream_url.lastIndexOf('/'));
                            var str_s_e = s_e.match(/s(\d+)e(\d+?)_\d+\.mp4/i);
                            if (str_s_e) {
                                var _seas_num = parseInt(str_s_e[1]);
                                var _epis_num = parseInt(str_s_e[2]);
                                items.push({
                                    id: _seas_num + '_' + _epis_num,
                                    comment: _epis_num + ' Епізод <i>' + ID + '</i>',
                                    file: stream_url,
                                    episode: _epis_num,
                                    season: _seas_num,
                                    quality: max_quality,
                                    qualities: quality_eps,
                                    translation: transl_id
                                });
                            }
                        }
                        if (!extract[transl_id]) extract[transl_id] = { json: [], file: '' };
                        extract[transl_id].json.push({ id: seas_num, comment: seas_num + ' Сезон', folder: items, translation: transl_id });
                    }
                }
            } else if (pl_links.movie && pl_links.movie.length > 0) {
                var _transl_id = 0;
                for (var _ID in pl_links.movie) {
                    var _file_episod = pl_links.movie[_ID];
                    ++_transl_id;
                    var _quality_eps = _file_episod.link.match(/.+\[(.+[\d])[,]+?\].+/i);
                    if (_quality_eps) _quality_eps = _quality_eps[1].split(',').filter(function(quality_) { return quality_ <= optimal_quality; });
                    var _max_quality = Math.max.apply(null, _quality_eps);
                    var file_url = _file_episod.link.replace(/\[(.+[\d])[,]+?\]/i, _max_quality);
                    extract[_transl_id] = { file: file_url, translation: _file_episod.translation, quality: _max_quality, qualities: _quality_eps };
                }
            }
        }

        function getFile(element, max_quality) {
            var translat = extract[element.translation];
            var id = element.season + '_' + element.episode;
            var file = '';
            var quality = false;
            if (translat) {
                if (element.season)
                    for (var i in translat.json) {
                        var elem = translat.json[i];
                        if (elem.folder) for (var f in elem.folder) { var folder = elem.folder[f]; if (folder.id == id) { file = folder.file; break; } } else { if (elem.id == id) { file = elem.file; break; } }
                    } else file = translat.file;
            }
            max_quality = parseInt(max_quality);
            if (file) {
                var link = file.slice(0, file.lastIndexOf('_')) + '_';
                var orin = file.split('?'); orin = orin.length > 1 ? '?' + orin.slice(1).join('?') : '';
                if (file.split('_').pop().replace('.mp4', '') !== max_quality) { file = link + max_quality + '.mp4' + orin; }
                quality = {};
                var mass = [2160, 1440, 1080, 720, 480, 360];
                mass = mass.slice(mass.indexOf(max_quality));
                mass.forEach(function(n) { quality[n + 'p'] = link + n + '.mp4' + orin; });
                var preferably = Lampa.Storage.get('video_quality_default', '1080') + 'p';
                if (quality[preferably]) file = quality[preferably];
            }
            return { file: file, quality: quality };
        }

        function filter() {
            filter_items = { season: [], voice: [], voice_info: [] };
            if (results.last_episode && results.last_episode.season) {
                var s = results.last_episode.season;
                while (s--) { filter_items.season.push('Сезон ' + (results.last_episode.season - s)); }
            }
            for (var Id in results.player_links.playlist) {
                var season = results.player_links.playlist[Id];
                var d = 0;
                for (var voic in season) { ++d; if (filter_items.voice.indexOf(voic) == -1) { filter_items.voice.push(voic); filter_items.voice_info.push({ id: d }); } }
            }
            var voice_with_info = filter_items.voice.map(function(v, i) { return { name: v, info: filter_items.voice_info[i] }; });
            voice_with_info.sort(function(a, b) {
                var aUkr = a.name.toLowerCase().includes('ukr') || a.name.toLowerCase().includes('україн');
                var bUkr = b.name.toLowerCase().includes('ukr') || b.name.toLowerCase().includes('україн');
                if (aUkr && !bUkr) return -1; if (!aUkr && bUkr) return 1; return a.name.localeCompare(b.name);
            });
            filter_items.voice = voice_with_info.map(function(v) { return v.name; });
            filter_items.voice_info = voice_with_info.map(function(v) { return v.info; });
            if (choice.voice_name) {
                var inx = filter_items.voice.map(function(v) { return v.toLowerCase(); }).indexOf(choice.voice_name.toLowerCase());
                if (inx == -1) choice.voice = 0; else if (inx !== choice.voice) { choice.voice = inx; }
            }
            component.filter(filter_items, choice);
        }

        function filtred() {
            var filtred = [];
            if (Object.keys(results.player_links.playlist).length) {
                for (var transl in extract) {
                    var element = extract[transl];
                    for (var season_id in element.json) {
                        var episode = element.json[season_id];
                        if (episode.id == choice.season + 1) {
                            episode.folder.forEach(function(media) {
                                if (media.translation == filter_items.voice_info[choice.voice].id) {
                                    filtred.push({
                                        episode: parseInt(media.episode), season: media.season, title: 'Епізод ' + media.episode + (media.title ? ' - ' + media.title : ''),
                                        quality: media.quality + 'p', translation: media.translation, voice_name: filter_items.voice[choice.voice], info: '🎬 ' + filter_items.voice[choice.voice]
                                    });
                                }
                            });
                        }
                    }
                }
            } else if (Object.keys(results.player_links.movie).length) {
                for (var transl_id in extract) {
                    var _element = extract[transl_id];
                    filtred.push({ title: _element.translation, quality: _element.quality + 'p', qualitys: _element.qualities, translation: transl_id, voice_name: _element.translation });
                }
            }
            return filtred;
        }

        function toPlayElement(element) {
            var extra = getFile(element, element.quality);
            var play = { title: element.title, url: extra.file, quality: extra.quality, timeline: element.timeline, callback: element.mark };
            return play;
        }

        function append(items) {
            component.reset();
            component.draw(items, {
                similars: wait_similars,
                onEnter: function onEnter(item, html) {
                    var extra = getFile(item, item.quality);
                    if (extra.file) {
                        var playlist = [];
                        var first = toPlayElement(item);
                        if (item.season) { items.forEach(function(elem) { playlist.push(toPlayElement(elem)); }); } else { playlist.push(first); }
                        if (playlist.length > 1) first.playlist = playlist;
                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);
                        item.mark();
                    } else Lampa.Noty.show('Посилання недоступне');
                },
                onContextMenu: function onContextMenu(item, html, data, call) { call(getFile(item, item.quality)); }
            });
        }
    }

    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var sources = { fxapi: fxapi };
        var last;
        var extended;
        var selected_id;
        var source;
        var balanser = 'fxapi';
        var initialized;
        var balanser_timer;
        var images = [];
        var filter_translate = { season: 'Сезон', voice: 'Озвучка', source: 'Джерело' };
        this.initialize = function() {
            var _this = this; source = this.createSource();
            filter.onSearch = function(value) { Lampa.Activity.replace({ search: value, clarification: true }); };
            filter.onBack = function() { _this.start(); };
            filter.render().find('.selector').on('hover:enter', function() { clearInterval(balanser_timer); });
            filter.onSelect = function(type, a, b) {
                if (type == 'filter') { if (a.reset) { if (extended) source.reset(); else _this.start(); } else source.filter(type, a, b); } else if (type == 'sort') { Lampa.Select.close(); }
            };
            if (filter.addButtonBack) filter.addButtonBack();
            filter.render().find('.filter--sort').remove();
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.body().addClass('torrent-list');
            scroll.minus(files.render().find('.explorer__files-head'));
            this.search();
        };
        this.createSource = function() { return new sources[balanser](this, object); };
        this.create = function() { return this.render(); };
        this.search = function() { this.activity.loader(true); this.find(); };
        this.find = function() { if (source.searchByTitle) { this.extendChoice(); source.searchByTitle(object, object.search || object.movie.original_title || object.movie.original_name || object.movie.title || object.movie.name); } };
        this.getChoice = function(for_balanser) {
            var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
            var save = data[selected_id || object.movie.id] || {};
            Lampa.Arrays.extend(save, { season: 0, voice: 0, voice_name: '', voice_id: 0, episodes_view: {}, movie_view: '' });
            return save;
        };
        this.extendChoice = function() { extended = true; source.extendChoice(this.getChoice()); };
        this.saveChoice = function(choice, for_balanser) {
            var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
            data[selected_id || object.movie.id] = choice;
            Lampa.Storage.set('online_choice_' + (for_balanser || balanser), data);
        };

        this.similars = function(json) {
            var _this3 = this;
            json.forEach(function(elem) {
                var info = [];
                var year = ((elem.start_date || elem.year || '') + '').slice(0, 4);
                if (elem.rating && elem.rating !== 'null' && elem.filmId) info.push('<span class="online-prestige-rate">⭐ ' + elem.rating + '</span>');
                if (year) info.push(year);
                if (elem.countries && elem.countries.length) { info.push((elem.filmId ? elem.countries.map(function(c) { return c.country; }) : elem.countries).join(', ')); }
                if (elem.categories && elem.categories.length) { info.push(elem.categories.slice(0, 4).join(', ')); }
                var name = elem.title || elem.ru_title || elem.en_title || elem.nameRu || elem.nameEn;
                var orig = elem.orig_title || elem.nameEn || '';
                elem.title = name + (orig && orig !== name ? ' / ' + orig : '');
                elem.time = elem.filmLength || '';
                elem.info = info.join('<span class="online-prestige-split"> • </span>');
                var item = Lampa.Template.get('online_prestige_folder', elem);
                item.on('hover:enter', function() {
                    _this3.activity.loader(true); _this3.reset(); object.search_date = year; selected_id = elem.id; _this3.extendChoice();
                    if (source.search) { source.search(object, [elem]); } else { _this3.doesNotAnswer(); }
                }).on('hover:focus', function(e) { last = e.target; scroll.update($(e.target), true); });
                scroll.append(item);
            });
        };
        this.clearImages = function() { images.forEach(function(img) { img.onerror = function() {}; img.onload = function() {}; img.src = ''; }); images = []; };
        this.reset = function() { last = false; clearInterval(balanser_timer); network.clear(); this.clearImages(); scroll.render().find('.empty').remove(); scroll.clear(); };
        this.loading = function(status) { if (status) this.activity.loader(true); else { this.activity.loader(false); this.activity.toggle(); } };
        this.closeFilter = function() { if ($('body').hasClass('selectbox--open')) Lampa.Select.close(); };
        this.selected = function(filter_items) {
            var need = this.getChoice(), select = [];
            for (var i in need) { if (filter_items[i] && filter_items[i].length) { if (i == 'voice') { select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]); } else if (i !== 'source') { if (filter_items.season.length >= 1) { select.push(filter_translate.season + ': ' + filter_items[i][need[i]]); } } } }
            filter.chosen('filter', select); filter.chosen('sort', [balanser]);
        };
        this.getEpisodes = function(season, call) {
            var episodes = [];
            if (typeof object.movie.id == 'number' && object.movie.name) {
                var tmdburl = 'tv/' + object.movie.id + '/season/' + season + '?api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'uk');
                var baseurl = Lampa.TMDB.api(tmdburl);
                network.timeout(1000 * 10);
                network["native"](baseurl, function(data) { episodes = data.episodes || []; call(episodes); }, function(a, c) { call(episodes); });
            } else call(episodes);
        };
        this.append = function(item) { item.on('hover:focus', function(e) { last = e.target; scroll.update($(e.target), true); }); scroll.append(item); };
        this.watched = function(set) {
            var file_id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
            var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
            if (set) { if (!watched[file_id]) watched[file_id] = {}; Lampa.Arrays.extend(watched[file_id], set, true); Lampa.Storage.set('online_watched_last', watched); } else { return watched[file_id]; }
        };
        this.draw = function(items) {
            var _this5 = this; var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {}; if (!items.length) return this.empty();
            this.getEpisodes(items[0].season, function(episodes) {
                var viewed = Lampa.Storage.cache('online_view', 5000, []); var serial = object.movie.name ? true : false; var choice = _this5.getChoice(); var fully = window.innerWidth > 480; var scroll_to_element = false; var scroll_to_mark = false;
                items.forEach(function(element, index) {
                    var episode = serial && episodes.length && !params.similars ? episodes.find(function(e) { return e.episode_number == element.episode; }) : false;
                    var episode_num = element.episode || index + 1; var episode_last = choice.episodes_view[element.season];
                    Lampa.Arrays.extend(element, { info: '', quality: '', time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true) });
                    var hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.episode, object.movie.original_title].join('') : object.movie.original_title);
                    var hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
                    var data = { hash_timeline: hash_timeline, hash_behold: hash_behold };
                    var info = [];
                    if (element.season) { element.translate_episode_end = _this5.getLastEpisode(items); element.translate_voice = element.voice_name; }
                    element.timeline = Lampa.Timeline.view(hash_timeline);
                    if (episode) {
                        element.title = episode.name; if (element.info.length < 30 && episode.vote_average) info.push('<span class="online-prestige-rate">⭐ ' + parseFloat(episode.vote_average + '').toFixed(1) + '</span>');
                        if (episode.air_date && fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
                    } else if (object.movie.release_date && fully) { info.push(Lampa.Utils.parseTime(object.movie.release_date).full); }
                    if (!serial && object.movie.tagline && element.info.length < 30) info.push(object.movie.tagline);
                    if (element.info) info.push(element.info);
                    if (info.length) element.info = info.map(function(i) { return '<span>' + i + '</span>'; }).join('<span class="online-prestige-split"> • </span>');
                    var html = Lampa.Template.get('online_prestige_full', element);
                    var loader = html.find('.online-prestige__loader'); var image = html.find('.online-prestige__img');
                    if (!serial) { if (choice.movie_view == hash_behold) scroll_to_element = html; } else if (typeof episode_last !== 'undefined' && episode_last == episode_num) { scroll_to_element = html; }
                    if (serial && !episode) { image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>'); loader.remove(); } else {
                        var img = html.find('img')[0];
                        img.onerror = function() { img.src = './img/img_broken.svg'; };
                        img.onload = function() { image.addClass('online-prestige__img--loaded'); loader.remove(); if (serial) image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>'); };
                        img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path)); images.push(img);
                    }
                    html.find('.online-prestige__timeline').append(Lampa.Timeline.render(element.timeline));
                    if (viewed.indexOf(hash_behold) !== -1) { scroll_to_mark = html; html.find('.online-prestige__img').append('<div class="online-prestige__viewed">✓</div>'); }
                    element.mark = function() {
                        viewed = Lampa.Storage.cache('online_view', 5000, []);
                        if (viewed.indexOf(hash_behold) == -1) { viewed.push(hash_behold); Lampa.Storage.set('online_view', viewed); if (html.find('.online-prestige__viewed').length == 0) { html.find('.online-prestige__img').append('<div class="online-prestige__viewed">✓</div>'); } }
                        choice = _this5.getChoice(); if (!serial) { choice.movie_view = hash_behold; } else { choice.episodes_view[element.season] = episode_num; }
                        _this5.saveChoice(choice);
                        _this5.watched({ balanser: balanser, balanser_name: 'Filmix', voice_id: choice.voice_id, voice_name: choice.voice_name || element.voice_name, episode: element.episode, season: element.season });
                    };
                    element.unmark = function() {
                        viewed = Lampa.Storage.cache('online_view', 5000, []);
                        if (viewed.indexOf(hash_behold) !== -1) { Lampa.Arrays.remove(viewed, hash_behold); Lampa.Storage.set('online_view', viewed); if (Lampa.Manifest.app_digital >= 177) Lampa.Storage.remove('online_view', hash_behold); html.find('.online-prestige__viewed').remove(); }
                    };
                    element.timeclear = function() { element.timeline.percent = 0; element.timeline.time = 0; element.timeline.duration = 0; Lampa.Timeline.update(element.timeline); };
                    html.on('hover:enter', function() { if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100); if (params.onEnter) params.onEnter(element, html, data); }).on('hover:focus', function(e) { last = e.target; if (params.onFocus) params.onFocus(element, html, data); scroll.update($(e.target), true); });
                    if (params.onRender) params.onRender(element, html, data);
                    _this5.contextMenu({ html: html, element: element, onFile: function onFile(call) { if (params.onContextMenu) params.onContextMenu(element, html, data, call); }, onClearAllMark: function onClearAllMark() { items.forEach(function(elem) { elem.unmark(); }); }, onClearAllTime: function onClearAllTime() { items.forEach(function(elem) { elem.timeclear(); }); } });
                    scroll.append(html);
                });
                if (serial && episodes.length > items.length && !params.similars) {
                    var left = episodes.slice(items.length);
                    left.forEach(function(episode) {
                        var info = []; if (episode.vote_average) info.push('<span class="online-prestige-rate">⭐ ' + parseFloat(episode.vote_average + '').toFixed(1) + '</span>');
                        if (episode.air_date) info.push(Lampa.Utils.parseTime(episode.air_date).full);
                        var air = new Date((episode.air_date + '').replace(/-/g, '/')); var now = Date.now(); var day = Math.round((air.getTime() - now) / (24 * 60 * 60 * 1000)); var txt = 'Вийде через: ' + day + ' днів';
                        var html = Lampa.Template.get('online_prestige_full', { time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true), info: info.length ? info.map(function(i) { return '<span>' + i + '</span>'; }).join('<span class="online-prestige-split"> • </span>') : '', title: episode.name, quality: day > 0 ? txt : '' });
                        var loader = html.find('.online-prestige__loader'); var image = html.find('.online-prestige__img'); var season = items[0] ? items[0].season : 1;
                        html.find('.online-prestige__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
                        var img = html.find('img')[0];
                        if (episode.still_path) { img.onerror = function() { img.src = './img/img_broken.svg'; }; img.onload = function() { image.addClass('online-prestige__img--loaded'); loader.remove(); image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>'); }; img.src = Lampa.TMDB.image('t/p/w300' + episode.still_path); images.push(img); } else { loader.remove(); image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>'); }
                        html.on('hover:focus', function(e) { last = e.target; scroll.update($(e.target), true); }); scroll.append(html);
                    });
                }
                if (scroll_to_element) { last = scroll_to_element[0]; } else if (scroll_to_mark) { last = scroll_to_mark[0]; }
                Lampa.Controller.enable('content');
            });
        };
        this.contextMenu = function(params) {
            params.html.on('hover:long', function() {
                function show(extra) {
                    var enabled = Lampa.Controller.enabled().name; var menu = [];
                    if (Lampa.Platform.is('webos')) { menu.push({ title: 'Відкрити у - Webos', player: 'webos' }); }
                    if (Lampa.Platform.is('android')) { menu.push({ title: 'Відкрити у - Android', player: 'android' }); }
                    menu.push({ title: 'Відкрити у - Lampa', player: 'lampa' });
                    menu.push({ title: 'Відео', separator: true }); menu.push({ title: 'Позначити переглянутим', mark: true }); menu.push({ title: 'Зняти позначку', unmark: true }); menu.push({ title: 'Скинути час', timeclear: true });
                    if (extra) { menu.push({ title: 'Копіювати посилання', copylink: true }); }
                    menu.push({ title: 'Інше', separator: true });
                    if (Lampa.Account.logged() && params.element && typeof params.element.season !== 'undefined' && params.element.translate_voice) { menu.push({ title: 'Підписатися на озвучку', subscribe: true }); }
                    menu.push({ title: 'Зняти всі позначки', clearallmark: true }); menu.push({ title: 'Скинути всі таймкоди', timeclearall: true });
                    Lampa.Select.show({
                        title: 'Дії', items: menu, onBack: function onBack() { Lampa.Controller.toggle(enabled); },
                        onSelect: function onSelect(a) {
                            if (a.mark) params.element.mark(); if (a.unmark) params.element.unmark(); if (a.timeclear) params.element.timeclear(); if (a.clearallmark) params.onClearAllMark(); if (a.timeclearall) params.onClearAllTime();
                            Lampa.Controller.toggle(enabled);
                            if (a.player) { Lampa.Player.runas(a.player); params.html.trigger('hover:enter'); }
                            if (a.copylink) {
                                if (extra.quality) { var qual = []; for (var i in extra.quality) { qual.push({ title: i, file: extra.quality[i] }); } Lampa.Select.show({ title: 'Посилання', items: qual, onBack: function onBack() { Lampa.Controller.toggle(enabled); }, onSelect: function onSelect(b) { Lampa.Utils.copyTextToClipboard(b.file, function() { Lampa.Noty.show('Посилання скопійовано'); }, function() { Lampa.Noty.show('Помилка копіювання'); }); } }); } else { Lampa.Utils.copyTextToClipboard(extra.file, function() { Lampa.Noty.show('Посилання скопійовано'); }, function() { Lampa.Noty.show('Помилка копіювання'); }); }
                            }
                            if (a.subscribe) { Lampa.Account.subscribeToTranslation({ card: object.movie, season: params.element.season, episode: params.element.translate_episode_end, voice: params.element.translate_voice }, function() { Lampa.Noty.show('Підписка оформлена'); }, function() { Lampa.Noty.show('Помилка підписки'); }); }
                        }
                    });
                }
                params.onFile(show);
            }).on('hover:focus', function() { if (Lampa.Helper) Lampa.Helper.show('online_file', 'Утримуйте клавішу "ОК" щоб відкрити меню', params.html); });
        };
        this.empty = function(msg) { var html = Lampa.Template.get('online_does_not_answer', {}); html.find('.online-empty__buttons').remove(); html.find('.online-empty__title').text('Нічого не знайдено'); scroll.append(html); this.loading(false); };
        this.doesNotAnswer = function() { var _this6 = this; this.reset(); var html = Lampa.Template.get('online_does_not_answer', { balanser: 'Filmix' }); scroll.append(html); this.loading(false); };
        this.getLastEpisode = function(items) { var last_episode = 0; items.forEach(function(e) { if (typeof e.episode !== 'undefined') last_episode = Math.max(last_episode, parseInt(e.episode)); }); return last_episode; };
        this.render = function() { return files.render(); };
        this.start = function() {
            if (Lampa.Activity.active().activity !== this.activity) return; if (!initialized) { initialized = true; this.initialize(); }
            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            Lampa.Controller.add('content', {
                toggle: function toggle() { Lampa.Controller.collectionSet(scroll.render(), files.render()); Lampa.Controller.collectionFocus(last || false, scroll.render()); },
                up: function up() { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function down() { Navigator.move('down'); },
                right: function right() { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show('Фільтр', 'filter'); },
                left: function left() { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                gone: function gone() { clearInterval(balanser_timer); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };
        this.pause = function() {}; this.stop = function() {};
        this.destroy = function() { network.clear(); files.destroy(); scroll.destroy(); clearInterval(balanser_timer); if (source) source.destroy(); };
    }

    function startPlugin() {
        window.plugin_filmix_ready = true;
        window.fxapi = { max_qualitie: 1080 };
        Lampa.Component.add('filmix', component);

        var manifest = { type: 'video', version: '1.2.0', name: 'Filmix', description: 'Плагін для перегляду фільмів та серіалів з Filmix', component: 'filmix', icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 2L2 10v16l16 8 16-8V10L18 2z" fill="white"/></svg>' };
        Lampa.Manifest.plugins = manifest;

        function resetTemplates() {
            Lampa.Template.add('online_prestige_full', '<div class="online-prestige online-prestige--full selector"><div class="online-prestige__img"><img alt=""><div class="online-prestige__loader"></div></div><div class="online-prestige__body"><div class="online-prestige__head"><div class="online-prestige__title">{title}</div><div class="online-prestige__time">{time}</div></div><div class="online-prestige__timeline"></div><div class="online-prestige__footer"><div class="online-prestige__info">{info}</div><div class="online-prestige__quality">{quality}</div></div></div></div>');
            Lampa.Template.add('online_prestige_folder', '<div class="online-prestige online-prestige--folder selector"><div class="online-prestige__folder"><svg width="128" height="112" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg"><rect y="20" width="128" height="92" rx="13" fill="white"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9554 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/></svg></div><div class="online-prestige__body"><div class="online-prestige__head"><div class="online-prestige__title">{title}</div><div class="online-prestige__time">{time}</div></div><div class="online-prestige__footer"><div class="online-prestige__info">{info}</div></div></div></div>');
            Lampa.Template.add('online_does_not_answer', '<div class="online-empty"><div class="online-empty__title">Filmix не відповідає</div><div class="online-empty__time">Спробуйте пізніше</div><div class="online-empty__buttons"></div></div>');
            Lampa.Template.add('online_prestige_rate', '<div class="online-prestige-rate"><span>{rate}</span></div>');
        }

        // АГРЕСИВНА ВСТАВКА КНОПКИ
        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite') {
                var render = e.object.activity.render();
                var btn = $('<div class="full-start__button selector view--filmix" data-subtitle="Filmix"><svg width="30" height="30" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom: 5px;"><path d="M18 2L2 10v16l16 8 16-8V10L18 2z" fill="white"/></svg><span>Filmix</span></div>');

                btn.on('hover:enter', function() {
                    resetTemplates();
                    Lampa.Component.add('filmix', component);
                    Lampa.Activity.push({ url: '', title: 'Filmix', component: 'filmix', search: e.data.movie.title, search_one: e.data.movie.title, search_two: e.data.movie.original_title, movie: e.data.movie, page: 1 });
                });

                function insertButton() {
                    if (render.find('.view--filmix').length) return; // Вже є
                    var buttons = render.find('.full-start__buttons');
                    if (buttons.length) { buttons.append(btn); console.log('Filmix: Button inserted into .full-start__buttons'); } 
                    else {
                        var any = render.find('.selector.full-start__button').last();
                        if (any.length) { any.after(btn); console.log('Filmix: Button inserted after another button'); }
                    }
                }

                // Пробуємо одразу і потім ще кілька разів (бо інші плагіни можуть гальмувати)
                insertButton();
                setTimeout(insertButton, 500);
                setTimeout(insertButton, 1000);
                setTimeout(insertButton, 2000);
            }
        });
    }

    if (window.Lampa) startPlugin();
    else { window.addEventListener('load', function() { if (window.Lampa) startPlugin(); }); }
})();
