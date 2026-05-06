export function renderCategoryCards(container, categories, options = {}) {
    container.empty();
    categories.forEach((category, index) => {
        var _a;
        const cardRow = container.createDiv('expensica-category-card-row');
        const card = cardRow.createDiv('expensica-category-card');
        if (options.onClick && category.id) {
            card.addClass('expensica-category-card-interactive');
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.addEventListener('click', () => { var _a; return (_a = options.onClick) === null || _a === void 0 ? void 0 : _a.call(options, category); });
            card.addEventListener('keydown', (event) => {
                var _a;
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                (_a = options.onClick) === null || _a === void 0 ? void 0 : _a.call(options, category);
            });
        }
        if (options.onSearchClick && category.id) {
            const searchButton = cardRow.createEl('button', {
                cls: 'expensica-category-card-search-button',
                attr: {
                    type: 'button',
                    'aria-label': `Show transactions for ${category.name}`,
                    title: `Show transactions for ${category.name}`
                }
            });
            searchButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
            searchButton.addEventListener('click', (event) => {
                var _a;
                event.stopPropagation();
                (_a = options.onSearchClick) === null || _a === void 0 ? void 0 : _a.call(options, category);
            });
        }
        const meta = card.createDiv('expensica-category-card-meta');
        const swatch = meta.createSpan('expensica-category-card-swatch');
        swatch.style.backgroundColor = category.color;
        meta.createSpan({
            text: category.emoji || '*',
            cls: 'expensica-category-card-emoji'
        });
        meta.createSpan({
            text: category.name,
            cls: 'expensica-category-card-name'
        });
        const graph = card.createDiv('expensica-category-card-graph');
        graph.createSpan({
            text: `${category.percentage.toFixed(1)}%`,
            cls: 'expensica-category-card-percentage'
        });
        const bar = graph.createDiv('expensica-category-card-bar');
        const fill = bar.createDiv('expensica-category-card-fill');
        fill.style.width = `${Math.max(0, Math.min(100, category.percentage))}%`;
        fill.style.backgroundColor = category.color;
        graph.createSpan({
            text: (_a = category.formattedAmount) !== null && _a !== void 0 ? _a : '',
            cls: 'expensica-category-card-amount'
        });
        if (options.onHoverStart) {
            card.addEventListener('pointerenter', (event) => {
                var _a;
                card.addClass('is-hovered');
                (_a = options.onHoverStart) === null || _a === void 0 ? void 0 : _a.call(options, index, event);
            });
        }
        if (options.onHoverEnd) {
            card.addEventListener('pointerleave', () => {
                var _a;
                card.removeClass('is-hovered');
                (_a = options.onHoverEnd) === null || _a === void 0 ? void 0 : _a.call(options, index);
            });
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2F0ZWdvcmllcy1jYXJkcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNhdGVnb3JpZXMtY2FyZHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBZ0JBLE1BQU0sVUFBVSxtQkFBbUIsQ0FDL0IsU0FBc0IsRUFDdEIsVUFBOEIsRUFDOUIsVUFBcUMsRUFBRTtJQUV2QyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7SUFFbEIsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsRUFBRTs7UUFDbkMsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO1FBQ25FLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUMxRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLElBQUksUUFBUSxDQUFDLEVBQUUsRUFBRTtZQUNoQyxJQUFJLENBQUMsUUFBUSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7WUFDckQsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDcEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDbkMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUUsV0FBQyxPQUFBLE1BQUEsT0FBTyxDQUFDLE9BQU8sd0RBQUcsUUFBUSxDQUFDLENBQUEsRUFBQSxDQUFDLENBQUM7WUFDbEUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFOztnQkFDdkMsSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLE9BQU8sSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLEdBQUcsRUFBRTtvQkFDNUMsT0FBTztpQkFDVjtnQkFFRCxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUM7Z0JBQ3ZCLE1BQUEsT0FBTyxDQUFDLE9BQU8s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SSxDQUFDLFdBQVcsQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDL0IsTUFBQSxPQUFPLENBQUMsVUFBVSx3REFBRyxLQUFLLENBQUMsQ0FBQztZQUNoQyxDQUFDLENBQUMsQ0FBQztTQUNOO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGludGVyZmFjZSBDYXRlZ29yeUNhcmREYXRhIHtcbiAgICBpZD86IHN0cmluZztcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgY29sb3I6IHN0cmluZztcbiAgICBlbW9qaT86IHN0cmluZztcbiAgICBwZXJjZW50YWdlOiBudW1iZXI7XG4gICAgZm9ybWF0dGVkQW1vdW50Pzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgQ2F0ZWdvcnlDYXJkUmVuZGVyT3B0aW9ucyB7XG4gICAgb25Ib3ZlclN0YXJ0PzogKGluZGV4OiBudW1iZXIsIGV2ZW50OiBQb2ludGVyRXZlbnQpID0+IHZvaWQ7XG4gICAgb25Ib3ZlckVuZD86IChpbmRleDogbnVtYmVyKSA9PiB2b2lkO1xuICAgIG9uQ2xpY2s/OiAoY2F0ZWdvcnk6IENhdGVnb3J5Q2FyZERhdGEpID0+IHZvaWQ7XG4gICAgb25TZWFyY2hDbGljaz86IChjYXRlZ29yeTogQ2F0ZWdvcnlDYXJkRGF0YSkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNhdGVnb3J5Q2FyZHMoXG4gICAgY29udGFpbmVyOiBIVE1MRWxlbWVudCxcbiAgICBjYXRlZ29yaWVzOiBDYXRlZ29yeUNhcmREYXRhW10sXG4gICAgb3B0aW9uczogQ2F0ZWdvcnlDYXJkUmVuZGVyT3B0aW9ucyA9IHt9XG4pIHtcbiAgICBjb250YWluZXIuZW1wdHkoKTtcblxuICAgIGNhdGVnb3JpZXMuZm9yRWFjaCgoY2F0ZWdvcnksIGluZGV4KSA9PiB7XG4gICAgICAgIGNvbnN0IGNhcmRSb3cgPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1yb3cnKTtcbiAgICAgICAgY29uc3QgY2FyZCA9IGNhcmRSb3cuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZCcpO1xuICAgICAgICBpZiAob3B0aW9ucy5vbkNsaWNrICYmIGNhdGVnb3J5LmlkKSB7XG4gICAgICAgICAgICBjYXJkLmFkZENsYXNzKCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1pbnRlcmFjdGl2ZScpO1xuICAgICAgICAgICAgY2FyZC5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnYnV0dG9uJyk7XG4gICAgICAgICAgICBjYXJkLnNldEF0dHJpYnV0ZSgndGFiaW5kZXgnLCAnMCcpO1xuICAgICAgICAgICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IG9wdGlvbnMub25DbGljaz8uKGNhdGVnb3J5KSk7XG4gICAgICAgICAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQua2V5ICE9PSAnRW50ZXInICYmIGV2ZW50LmtleSAhPT0gJyAnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIG9wdGlvbnMub25DbGljaz8uKGNhdGVnb3J5KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG9wdGlvbnMub25TZWFyY2hDbGljayAmJiBjYXRlZ29yeS5pZCkge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQnV0dG9uID0gY2FyZFJvdy5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYXRlZ29yeS1jYXJkLXNlYXJjaC1idXR0b24nLFxuICAgICAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2J1dHRvbicsXG4gICAgICAgICAgICAgICAgICAgICdhcmlhLWxhYmVsJzogYFNob3cgdHJhbnNhY3Rpb25zIGZvciAke2NhdGVnb3J5Lm5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGBTaG93IHRyYW5zYWN0aW9ucyBmb3IgJHtjYXRlZ29yeS5uYW1lfWBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHNlYXJjaEJ1dHRvbi5pbm5lckhUTUwgPSAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgd2lkdGg9XCIxOFwiIGhlaWdodD1cIjE4XCIgdmlld0JveD1cIjAgMCAyNCAyNFwiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMi4yXCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PGNpcmNsZSBjeD1cIjExXCIgY3k9XCIxMVwiIHI9XCI3XCI+PC9jaXJjbGU+PGxpbmUgeDE9XCIyMVwiIHkxPVwiMjFcIiB4Mj1cIjE2LjY1XCIgeTI9XCIxNi42NVwiPjwvbGluZT48L3N2Zz4nO1xuICAgICAgICAgICAgc2VhcmNoQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy5vblNlYXJjaENsaWNrPy4oY2F0ZWdvcnkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtZXRhID0gY2FyZC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYXRlZ29yeS1jYXJkLW1ldGEnKTtcbiAgICAgICAgY29uc3Qgc3dhdGNoID0gbWV0YS5jcmVhdGVTcGFuKCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1zd2F0Y2gnKTtcbiAgICAgICAgc3dhdGNoLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGNhdGVnb3J5LmNvbG9yO1xuXG4gICAgICAgIG1ldGEuY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICB0ZXh0OiBjYXRlZ29yeS5lbW9qaSB8fCAnKicsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1lbW9qaSdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbWV0YS5jcmVhdGVTcGFuKHtcbiAgICAgICAgICAgIHRleHQ6IGNhdGVnb3J5Lm5hbWUsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1uYW1lJ1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBncmFwaCA9IGNhcmQuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1ncmFwaCcpO1xuICAgICAgICBncmFwaC5jcmVhdGVTcGFuKHtcbiAgICAgICAgICAgIHRleHQ6IGAke2NhdGVnb3J5LnBlcmNlbnRhZ2UudG9GaXhlZCgxKX0lYCxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYXRlZ29yeS1jYXJkLXBlcmNlbnRhZ2UnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGJhciA9IGdyYXBoLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LWNhcmQtYmFyJyk7XG4gICAgICAgIGNvbnN0IGZpbGwgPSBiYXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktY2FyZC1maWxsJyk7XG4gICAgICAgIGZpbGwuc3R5bGUud2lkdGggPSBgJHtNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIGNhdGVnb3J5LnBlcmNlbnRhZ2UpKX0lYDtcbiAgICAgICAgZmlsbC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBjYXRlZ29yeS5jb2xvcjtcblxuICAgICAgICBncmFwaC5jcmVhdGVTcGFuKHtcbiAgICAgICAgICAgIHRleHQ6IGNhdGVnb3J5LmZvcm1hdHRlZEFtb3VudCA/PyAnJyxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYXRlZ29yeS1jYXJkLWFtb3VudCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKG9wdGlvbnMub25Ib3ZlclN0YXJ0KSB7XG4gICAgICAgICAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJlbnRlcicsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhcmQuYWRkQ2xhc3MoJ2lzLWhvdmVyZWQnKTtcbiAgICAgICAgICAgICAgICBvcHRpb25zLm9uSG92ZXJTdGFydD8uKGluZGV4LCBldmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvcHRpb25zLm9uSG92ZXJFbmQpIHtcbiAgICAgICAgICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmxlYXZlJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhcmQucmVtb3ZlQ2xhc3MoJ2lzLWhvdmVyZWQnKTtcbiAgICAgICAgICAgICAgICBvcHRpb25zLm9uSG92ZXJFbmQ/LihpbmRleCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuIl19