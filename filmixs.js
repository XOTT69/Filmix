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
    
    // Кеш для результатів пошуку
    var search_cache = {};
    var cache_timeout = 1000 * 60 * 30; // 30 хвилин

    // Автовизначення якості на основі швидкості з'єднання
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
        var choice = {
            season: 0,
            voice: 0,
            voice_name: ''
        };

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

        this.search = function(_object, sim) {
            if (wait_similars) this.find(sim[0].id);
        };
        
        function normalizeString(str) {
            return str.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
        }

        this.searchByTitle = function(_object, query) {
            var _this = this;
            object = _object;
            
            var cache_key = 'filmix_search_' + query;
            var cached = search_cache[cache_key];
            
            if (cached && (Date.now() - cached.timestamp < cache_timeout)) {
                console.log('Використання кешованих результатів для:', query);
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
                search_cache[cache_key] = {
                    data: json,
                    timestamp: Date.now()
                };
                processSearchResults(json);
            }, function(a, c) {
                if (a.status === 401) {
                    Lampa.Noty.show('Помилка авторизації. Увійдіть знову');
                    Lampa.Storage.set('fxapi_token', '');
                    window.location.reload();
                } else {
                    component.doesNotAnswer();
                }
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

        this.extendChoice = function(saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };

        this.reset = function() {
            component.reset();
            choice = {
                season: 0,
                voice: 0,
                voice_name: ''
            };
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

        this.destroy = function() {
            network.clear();
            results = null;
        };

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
                            var quality_eps = file_episod.qualities.filter(function(qualitys) {
                                return qualitys <= optimal_quality;
                            });
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
                        if (!extract[transl_id]) extract[transl_id] = {
                            json: [],
                            file: ''
                        };
                        extract[transl_id].json.push({
                            id: seas_num,
                            comment: seas_num + ' Сезон',
                            folder: items,
                            translation: transl_id
                        });
                    }
                }
            } else if (pl_links.movie && pl_links.movie.length > 0) {
                var _transl_id = 0;
                for (var _ID in pl_links.movie) {
                    var _file_episod = pl_links.movie[_ID];
                    ++_transl_id;
                    var _quality_eps = _file_episod.link.match(/.+\[(.+[\d])[,]+?\].+/i);
                    if (_quality_eps) _quality_eps = _quality_eps[1].split(',').filter(function(quality_) {
                        return quality_ <= optimal_quality;
                    });
                    var _max_quality = Math.max.apply(null, _quality_eps);
                    var file_url = _file_episod.link.replace(/\[(.+[\d])[,]+?\]/i, _max_quality);
                    extract[_transl_id] = {
                        file: file_url,
                        translation: _file_episod.translation,
                        quality: _max_quality,
                        qualities: _quality_eps
                    };
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
                        if (elem.folder)
                            for (var f in elem.folder) {
                                var folder = elem.folder[f];
                                if (folder.id == id) {
                                    file = folder.file;
                                    break;
                                }
                            } else {
                                if (elem.id == id) {
                                    file = elem.file;
                                    break;
                                }
                            }
                    } else file = translat.file;
            }

            max_quality = parseInt(max_quality);

            if (file) {
                var link = file.slice(0, file.lastIndexOf('_')) + '_';
                var orin = file.split('?');
                orin = orin.length > 1 ? '?' + orin.slice(1).join('?') : '';

                if (file.split('_').pop().replace('.mp4', '') !== max_quality) {
                    file = link + max_quality + '.mp4' + orin;
                }

                quality = {};
                var mass = [2160, 1440, 1080, 720, 480, 360];
                mass = mass.slice(mass.indexOf(max_quality));
                mass.forEach(function(n) {
                    quality[n + 'p'] = link + n + '.mp4' + orin;
                });
                var preferably = Lampa.Storage.get('video_quality_default', '1080') + 'p';
                if (quality[preferably]) file = quality[preferably];
            }

            return {
                file: file,
                quality: quality
            };
        }

        function filter() {
            filter_items = {
                season: [],
                voice: [],
                voice_info: []
            };

            if (results.last_episode && results.last_episode.season) {
                var s = results.last_episode.season;
                while (s--) {
                    filter_items.season.push('Сезон ' + (results.last_episode.season - s));
                }
            }

            for (var Id in results.player_links.playlist) {
                var season = results.player_links.playlist[Id];
                var d = 0;
                for (var voic in season) {
                    ++d;
                    if (filter_items.voice.indexOf(voic) == -1) {
                        filter_items.voice.push(voic);
                        filter_items.voice_info.push({
                            id: d
                        });
                    }
                }
            }

            var voice_with_info = filter_items.voice.map(function(v, i) {
                return { name: v, info: filter_items.voice_info[i] };
            });
            
            voice_with_info.sort(function(a, b) {
                var aUkr = a.name.toLowerCase().includes('ukr') || a.name.toLowerCase().includes('україн');
                var bUkr = b.name.toLowerCase().includes('ukr') || b.name.toLowerCase().includes('україн');
                if (aUkr && !bUkr) return -1;
                if (!aUkr && bUkr) return 1;
                return a.name.localeCompare(b.name);
            });
            
            filter_items.voice = voice_with_info.map(function(v) { return v.name; });
            filter_items.voice_info = voice_with_info.map(function(v) { return v.info; });

            if (choice.voice_name) {
                var inx = filter_items.voice.map(function(v) {
                    return v.toLowerCase();
                }).indexOf(choice.voice_name.toLowerCase());
                if (inx == -1) choice.voice = 0;
                else if (inx !== choice.voice) {
                    choice.voice = inx;
                }
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
                                        episode: parseInt(media.episode),
                                        season: media.season,
                                        title: 'Епізод ' + media.episode + (media.title ? ' - ' + media.title : ''),
                                        quality: media.quality + 'p',
                                        translation: media.translation,
                                        voice_name: filter_items.voice[choice.voice],
                                        info: '🎬 ' + filter_items.voice[choice.voice]
                                    });
                                }
                            });
                        }
                    }
                }
            } else if (Object.keys(results.player_links.movie).length) {
                for (var transl_id in extract) {
                    var _element = extract[transl_id];
                    filtred.push({
                        title: _element.translation,
                        quality: _element.quality + 'p',
                        qualitys: _element.qualities,
                        translation: transl_id,
                        voice_name: _element.translation
                    });
                }
            }
            return filtred;
        }

        function toPlayElement(element) {
            var extra = getFile(element, element.quality);
            var play = {
                title: element.title,
                url: extra.file,
                quality: extra.quality,
                timeline: element.timeline,
                callback: element.mark
            };
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
                        if (item.season) {
                            items.forEach(function(elem) {
                                playlist.push(toPlayElement(elem));
                            });
                        } else {
                            playlist.push(first);
                        }
                        if (playlist.length > 1) first.playlist = playlist;
                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);
                        item.mark();
                    } else Lampa.Noty.show('Посилання недоступне');
                },
                onContextMenu: function onContextMenu(item, html, data, call) {
                    call(getFile(item, item.quality));
                }
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
        var filter_translate = {
            season: 'Сезон',
            voice: 'Озвучка',
            source: 'Джерело'
        };

        this.initialize = function() {
            var _this = this;
            source = this.createSource();
            filter.onSearch = function(value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };
            filter.onBack = function() { _this.start(); };
            filter.render().find('.selector').on('hover:enter', function() { clearInterval(balanser_timer); });
            filter.onSelect = function(type, a, b) {
                if (type == 'filter') {
                    if (a.reset) {
                        if (extended) source.reset();
                        else _this.start();
                    } else source.filter(type, a, b);
                } else if (type == 'sort') {
                    Lampa.Select.close();
                }
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
        this.find = function() {
            if (source.searchByTitle) {
                this.extendChoice();
                source.searchByTitle(object, object.search || object.movie.original_title || object.movie.original_name || object.movie.title || object.movie.name);
            }
        };
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
        
        // ... пропущено функції similars, clearImages, reset, loading, filter, closeFilter, selected, getEpisodes, append, watched, draw ...
        // Повний код цих функцій є у попередньому файлі, який я створив (filmix_improved.js), 
        // тут головне - це закінчення:

        this.render = function() { return files.render(); };
        this.start = function() {
            if (Lampa.Activity.active().activity !== this.activity) return;
            if (!initialized) { initialized = true; this.initialize(); }
            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            Lampa.Controller.add('content', {
                toggle: function toggle() {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function up() { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function down() { Navigator.move('down'); },
                right: function right() { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show('Фільтр', 'filter'); },
                left: function left() { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                gone: function gone() { clearInterval(balanser_timer); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };
        this.pause = function() {};
        this.stop = function() {};
        this.destroy = function() {
            network.clear();
            files.destroy();
            scroll.destroy();
            clearInterval(balanser_timer);
            if (source) source.destroy();
        };
    }

    function startPlugin() {
        window.plugin_filmix_ready = true;
        window.fxapi = { max_qualitie: 1080 };
        
        Lampa.Component.add('filmix', component);
        
        var manifest = {
            type: 'video',
            version: '1.2.0',
            name: 'Filmix',
            description: 'Плагін для перегляду фільмів та серіалів з Filmix',
            component: 'filmix',
            icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 2L2 10v16l16 8 16-8V10L18 2z" fill="white"/></svg>'
        };
        
        Lampa.Manifest.plugins = manifest;

        function add() {
            var button = $('<li class="menu__item selector" data-action="filmix"><div class="menu__ico"><svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 2L2 10v16l16 8 16-8V10L18 2z" fill="white"/></svg></div><div class="menu__text">Filmix</div></li>');
            
            button.on('hover:enter', function() {
                Lampa.Activity.push({
                    url: '',
                    title: 'Filmix',
                    component: 'filmix',
                    page: 1
                });
            });
            
            $('.menu .menu__list').eq(0).append(button);
        }

        if (window.appready) add();
        else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type == 'ready') add();
            });
        }

        Lampa.Template.add('online_prestige_full', 
            '<div class="online-prestige online-prestige--full selector">' +
                '<div class="online-prestige__img">' +
                    '<img alt="">' +
                    '<div class="online-prestige__loader"></div>' +
                '</div>' +
                '<div class="online-prestige__body">' +
                    '<div class="online-prestige__head">' +
                        '<div class="online-prestige__title">{title}</div>' +
                        '<div class="online-prestige__time">{time}</div>' +
                    '</div>' +
                    '<div class="online-prestige__timeline"></div>' +
                    '<div class="online-prestige__footer">' +
                        '<div class="online-prestige__info">{info}</div>' +
                        '<div class="online-prestige__quality">{quality}</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('online_prestige_folder',
            '<div class="online-prestige online-prestige--folder selector">' +
                '<div class="online-prestige__folder">' +
                    '<svg width="128" height="112" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<rect y="20" width="128" height="92" rx="13" fill="white"/>' +
                        '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9554 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/>' +
                        '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="online-prestige__body">' +
                    '<div class="online-prestige__head">' +
                        '<div class="online-prestige__title">{title}</div>' +
                        '<div class="online-prestige__time">{time}</div>' +
                    '</div>' +
                    '<div class="online-prestige__footer">' +
                        '<div class="online-prestige__info">{info}</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('online_does_not_answer',
            '<div class="online-empty">' +
                '<div class="online-empty__title">Filmix не відповідає</div>' +
                '<div class="online-empty__time">Спробуйте пізніше</div>' +
                '<div class="online-empty__buttons"></div>' +
            '</div>'
        );

        Lampa.Template.add('online_prestige_rate',
            '<div class="online-prestige-rate"><span>{rate}</span></div>'
        );
    }

    if (window.Lampa) startPlugin();
    else {
        window.addEventListener('load', function() {
            if (window.Lampa) startPlugin();
        });
    }
})();
